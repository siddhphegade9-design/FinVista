'use strict';
/** Error type for expected, client-facing failures. The error handler turns it into JSON. */
class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

module.exports = {
  HttpError,
  badRequest: (message = 'Invalid request.', details) => new HttpError(400, 'BAD_REQUEST', message, details),
  unauthorized: (message = 'Authentication required.') => new HttpError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'You do not have access to this resource.') => new HttpError(403, 'FORBIDDEN', message),
  notFound: (message = 'Resource not found.') => new HttpError(404, 'NOT_FOUND', message),
  conflict: (message = 'Conflict.') => new HttpError(409, 'CONFLICT', message),
};
