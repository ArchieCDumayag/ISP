const express = require('express');
const createError = require('http-errors');
const jobsRouter = require('./jobs');
const ticketsModule = require('./tickets');
const technicianInventoryRouter = require('./technician-inventory');
const { requireTechnicianAuth } = require('../../customer-management/backend/customer-draft-submissions');

const router = express.Router();

router.use(requireTechnicianAuth);
router.use('/inventory', technicianInventoryRouter);

router.get('/jobs', async (req, res, next) => {
  try {
    if (typeof jobsRouter.readJobsForTechnician !== 'function') {
      throw createError(500, 'Technician jobs lookup is unavailable.');
    }

    const jobs = await jobsRouter.readJobsForTechnician(req.technician.branchId, req.technician, {
      includeClosed: false,
      includeUnassigned: false
    });
    const visibleJobs = typeof jobsRouter.deriveJobStatus === 'function'
      ? jobs
          .map((job) => ({
            ...job,
            status: jobsRouter.deriveJobStatus(job)
          }))
      : jobs;

    return res.json({
      ok: true,
      technician: req.technician,
      openOnly: true,
      count: visibleJobs.length,
      hasOpen: visibleJobs.length > 0,
      jobs: visibleJobs
    });
  } catch (error) {
    next(error);
  }
});

router.get('/tickets', async (req, res, next) => {
  try {
    if (typeof ticketsModule.readTicketsForTechnician !== 'function') {
      throw createError(500, 'Technician ticket lookup is unavailable.');
    }

    const tickets = await ticketsModule.readTicketsForTechnician(req.technician.branchId, req.technician, {
      includeClosed: false,
      includeUnassigned: false
    });
    const visibleTickets = tickets
      .map((ticket) => ({
        ...ticket,
        status: typeof ticketsModule.normalizeTicketStatus === 'function'
          ? ticketsModule.normalizeTicketStatus(ticket?.status, ticket?.assignedTo ? 'in-progress' : 'open')
          : String(ticket?.status || '').trim().toLowerCase()
      }));

    return res.json({
      ok: true,
      technician: req.technician,
      openOnly: true,
      count: visibleTickets.length,
      hasOpen: visibleTickets.length > 0,
      tickets: visibleTickets
    });
  } catch (error) {
    next(error);
  }
});

router.post('/jobs/sync', async (req, res, next) => {
  try {
    if (typeof jobsRouter.changeJobWorkflowStatus !== 'function') {
      throw createError(500, 'Technician job synchronization is unavailable.');
    }
    const mutations = Array.isArray(req.body?.mutations) ? req.body.mutations.slice(0, 100) : [];
    if (!mutations.length) {
      throw createError(400, 'At least one job mutation is required.');
    }

    const results = [];
    for (const mutation of mutations) {
      try {
        const result = await jobsRouter.changeJobWorkflowStatus({
          branchId: req.technician.branchId,
          technician: req.technician,
          actor: req.technician,
          actorType: 'technician',
          id: mutation?.jobId || mutation?.id,
          status: mutation?.status,
          expectedVersion: mutation?.expectedVersion,
          clientEventId: mutation?.clientEventId,
          details: mutation?.details || {},
          allowOverride: false
        });
        results.push({
          clientEventId: mutation?.clientEventId || '',
          ok: Boolean(result),
          duplicate: Boolean(result?.duplicate),
          job: result?.job || null,
          error: result ? '' : 'Job not found for this technician.'
        });
      } catch (error) {
        results.push({
          clientEventId: mutation?.clientEventId || '',
          ok: false,
          duplicate: false,
          status: Number(error?.statusCode || error?.status || 400),
          error: error?.message || 'Unable to apply job mutation.',
          currentJob: error?.currentJob || null
        });
      }
    }

    return res.json({
      ok: true,
      technician: req.technician,
      processed: results.length,
      applied: results.filter((result) => result.ok && !result.duplicate).length,
      duplicates: results.filter((result) => result.duplicate).length,
      failed: results.filter((result) => !result.ok).length,
      results
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/jobs/:id/status', async (req, res, next) => {
  try {
    if (typeof jobsRouter.changeJobWorkflowStatus !== 'function') {
      throw createError(500, 'Technician job update is unavailable.');
    }
    const status = String(req.body?.status || '').trim();
    if (!status) throw createError(400, 'Job status is required.');

    const result = await jobsRouter.changeJobWorkflowStatus({
      branchId: req.technician.branchId,
      technician: req.technician,
      actor: req.technician,
      actorType: 'technician',
      id: req.params.id,
      status,
      expectedVersion: req.body?.expectedVersion,
      clientEventId: req.body?.clientEventId,
      details: req.body?.details || req.body,
      allowOverride: false
    });
    if (!result) throw createError(404, 'Job not found for this technician.');

    return res.json({
      ok: true,
      technician: req.technician,
      ...result
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/jobs/:id/done', async (req, res, next) => {
  try {
    if (typeof jobsRouter.markJobDoneForTechnician !== 'function') {
      throw createError(500, 'Technician job update is unavailable.');
    }

    const job = await jobsRouter.markJobDoneForTechnician(req.technician.branchId, req.technician, req.params.id);
    if (!job) {
      throw createError(404, 'Job not found for this technician.');
    }

    return res.json({
      ok: true,
      technician: req.technician,
      job
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/tickets/:id/status', async (req, res, next) => {
  try {
    if (typeof ticketsModule.updateTicketStatusForTechnician !== 'function') {
      throw createError(500, 'Technician ticket update is unavailable.');
    }

    const status = String(req.body?.status || '').trim();
    if (!status) {
      throw createError(400, 'Ticket status is required.');
    }

    const ticket = await ticketsModule.updateTicketStatusForTechnician(
      req.technician.branchId,
      req.technician,
      req.params.id,
      status
    );
    if (!ticket) {
      throw createError(404, 'Ticket not found for this technician.');
    }

    return res.json({
      ok: true,
      technician: req.technician,
      ticket
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
