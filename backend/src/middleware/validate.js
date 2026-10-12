import { errors } from '../utils/errors.js';

export function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(errors.validation('Missing or malformed field.', {
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }));
    }
    req.body = result.data;
    next();
  };
}
