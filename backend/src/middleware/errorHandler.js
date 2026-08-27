function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err.isAppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;
