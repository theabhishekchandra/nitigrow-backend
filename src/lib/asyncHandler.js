/**
 * Wraps an async Express handler so rejected promises are forwarded to
 * `next(err)`. Eliminates the try/catch boilerplate found in older
 * controllers.
 *
 * @example
 *   router.get('/contacts', asyncHandler(async (req, res) => {
 *     const list = await Contact.find({ tenantId: req.user.tenantId });
 *     res.json(list);
 *   }));
 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
module.exports.asyncHandler = asyncHandler;
