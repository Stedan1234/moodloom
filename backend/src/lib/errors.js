// One error type for anything a route wants to turn into an HTTP response.
// `code` is a stable machine-readable string the web app can branch on
// (e.g. CLAIM_REQUIRED, PLAN_LIMIT) without parsing the human message.
export class HttpError extends Error {
  constructor(status, message, code = undefined, extra = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message, code) => new HttpError(400, message, code);
export const forbidden = (message, code) => new HttpError(403, message, code);
export const notFound = (message = 'Not found') => new HttpError(404, message);
