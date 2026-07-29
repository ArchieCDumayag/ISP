const express = require('express');
const createError = require('http-errors');
const jobsRouter = require('./jobs');
const ticketsModule = require('./tickets');
const { requireTechnicianAuth } = require('../../customer-management/backend/customer-draft-submissions');

const router = express.Router();

router.use(requireTechnicianAuth);

router.get('/jobs', async (req, res, next) => {
  try {
    if (typeof jobsRouter.readJobsForTechnician !== 'function') {
      throw createError(500, 'Technician jobs lookup is unavailable.');
    }

    const jobs = await jobsRouter.readJobsForTechnician(req.technician.branchId, req.technician, {
      includeClosed: false,
      includeUnassigned: true
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
      includeUnassigned: true
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
