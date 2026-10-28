'use strict';

function parseVirtualDisplayResult(text) {
  const value = JSON.parse(text);
  return {
    token: value.token ?? value.Token,
    success: value.success ?? value.Success,
    message: value.message ?? value.Message,
    error: value.error !== undefined ? value.error : value.Error
  };
}

module.exports = { parseVirtualDisplayResult };
