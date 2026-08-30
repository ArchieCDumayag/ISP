const fs = require('fs');
const os = require('os');
const path = require('path');

const normalizeOutput = (value) => String(value || '').trim();

function createSystemUpdateLocalChangesManager(options = {}) {
  const runGitStep = options.runGitStep;
  const runGitCommand = options.runGitCommand;
  const appendLog = typeof options.appendLog === 'function' ? options.appendLog : () => {};
  const tempRoot = options.tempRoot || os.tmpdir();

  if (typeof runGitStep !== 'function' || typeof runGitCommand !== 'function') {
    throw new TypeError('runGitStep and runGitCommand are required.');
  }

  const readGitValue = async (args) => {
    try {
      return normalizeOutput(await runGitCommand(args));
    } catch {
      return '';
    }
  };

  const cleanupPreflightWorktree = async (preflight) => {
    if (!preflight) return;
    if (preflight.worktreeAdded) {
      try {
        await runGitCommand(['worktree', 'remove', '--force', preflight.checkoutPath]);
      } catch (error) {
        appendLog(`\nWarning: unable to remove update preflight worktree: ${error.message || error}\n`);
      }
    }
    try {
      fs.rmSync(preflight.rootPath, { recursive: true, force: true });
    } catch (error) {
      appendLog(`\nWarning: unable to remove update preflight directory: ${error.message || error}\n`);
    }
    try {
      await runGitCommand(['worktree', 'prune']);
    } catch {
      // A stale temporary worktree can be pruned during a later update.
    }
  };

  const dropTemporaryStash = async (preservation) => {
    const currentStash = await readGitValue(['rev-parse', 'refs/stash']);
    if (currentStash !== preservation.stashCommit) {
      appendLog(`\nLocal-change backup ${preservation.stashCommit.slice(0, 12)} was retained because it is no longer the newest stash.\n`);
      return;
    }
    try {
      await runGitStep('Remove temporary local-change backup', ['stash', 'drop', 'stash@{0}']);
    } catch (error) {
      appendLog(`\nLocal changes were restored, but temporary backup ${preservation.stashCommit.slice(0, 12)} could not be removed: ${error.message || error}\n`);
    }
  };

  const restore = async (preservation, restoreOptions = {}) => {
    const force = restoreOptions.force === true;
    if (!preservation || (preservation.restored && !force)) return preservation;
    await runGitStep('Restore preserved local changes', [
      'stash',
      'apply',
      '--index',
      preservation.stashCommit
    ]);
    preservation.restored = true;
    if (restoreOptions.dropBackup !== false) {
      await dropTemporaryStash(preservation);
    }
    return preservation;
  };

  const prepare = async ({ targetRef, changedFileCount = 0 } = {}) => {
    const normalizedTarget = normalizeOutput(targetRef);
    if (!normalizedTarget) {
      throw new Error('A verified update target is required before preserving local changes.');
    }

    const statusBefore = await readGitValue(['status', '--porcelain']);
    if (!statusBefore) return null;

    const previousStash = await readGitValue(['rev-parse', 'refs/stash']);
    const backupLabel = `isp-system-update-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await runGitStep('Preserve local changes', [
      'stash',
      'push',
      '--include-untracked',
      '--message',
      backupLabel
    ]);

    const stashCommit = await readGitValue(['rev-parse', 'refs/stash']);
    if (!stashCommit || stashCommit === previousStash) {
      throw new Error('Git did not create the required local-change backup.');
    }

    const preservation = {
      stashCommit,
      changedFileCount: Math.max(1, Number(changedFileCount) || statusBefore.split(/\r?\n/).filter(Boolean).length),
      restored: false
    };
    let preflight = null;

    try {
      const preflightRoot = fs.mkdtempSync(path.join(tempRoot, 'isp-system-update-'));
      preflight = {
        rootPath: preflightRoot,
        checkoutPath: path.join(preflightRoot, 'checkout'),
        worktreeAdded: false
      };
      await runGitStep('Prepare local-change compatibility check', [
        'worktree',
        'add',
        '--detach',
        preflight.checkoutPath,
        normalizedTarget
      ]);
      preflight.worktreeAdded = true;
      await runGitStep('Check local changes against update', [
        '-C',
        preflight.checkoutPath,
        'stash',
        'apply',
        '--index',
        stashCommit
      ]);
      return preservation;
    } catch (error) {
      const isSingleChange = preservation.changedFileCount === 1;
      const changeLabel = `${preservation.changedFileCount} local file change${isSingleChange ? '' : 's'}`;
      const conflict = new Error(`Local changes conflict with the incoming update. No update was applied; ${changeLabel} ${isSingleChange ? 'was' : 'were'} restored.`);
      conflict.code = 'SYSTEM_UPDATE_LOCAL_CHANGES_CONFLICT';
      conflict.cause = error;
      try {
        await restore(preservation);
      } catch (restoreError) {
        conflict.code = 'SYSTEM_UPDATE_LOCAL_CHANGES_RECOVERY_FAILED';
        conflict.message = `Local changes conflict with the incoming update, and automatic recovery could not restore them. The backup ${stashCommit.slice(0, 12)} was retained. ${restoreError.message || restoreError}`;
      }
      throw conflict;
    } finally {
      await cleanupPreflightWorktree(preflight);
    }
  };

  return Object.freeze({
    prepare,
    restore,
    dropBackup: dropTemporaryStash
  });
}

module.exports = {
  createSystemUpdateLocalChangesManager
};
