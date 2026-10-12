import { ipInAllowedSubnets } from '../utils/ip.js';
import { errors } from '../utils/errors.js';

export function requireAllowedSubnet(req, _res, next) {
  if (!ipInAllowedSubnets(req)) return next(errors.networkNotAllowed());
  next();
}
