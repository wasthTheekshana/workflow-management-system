const AppError = require('./AppError');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function assertUuid(value, fieldName) {
  if (!isUuid(value)) {
    throw new AppError(400, `${fieldName} must be a valid UUID`);
  }
}

function assertRequiredString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(400, `${fieldName} is required`);
  }
}

module.exports = { isUuid, assertUuid, assertRequiredString };
