// Transport log text is untrusted and may include URLs/opaque account details.
// Return only an allowlisted category/status, never a quote or arbitrary code.
export function classifyCodexTransportWarning(body) {
  const text = typeof body === 'string' ? body : '';
  const match = /(?:http(?:\/[\d.]+)?\s+|unexpected\s+status(?:\s+code)?[:=\s]+|status(?:\s+code)?[:=\s]+)(400|401|403|408|409|429|500|502|503|504)\b/i.exec(text);
  const httpStatus = match ? Number(match[1]) : null;
  let category;
  if (text.includes('error decoding response body')) category = 'response-body-decode';
  else if (httpStatus === 429 || /too many requests|rate[- ]limit/i.test(text)) category = 'rate-limit-warning';
  else if (httpStatus === 401 || httpStatus === 403) category = 'authentication-http-warning';
  else if (httpStatus !== null) category = 'http-status-warning';
  else if (/stream.*disconnect/i.test(text)) category = 'stream-disconnected';
  else if (/unexpected.*eof/i.test(text)) category = 'unexpected-eof';
  else if (/timed?[- ]?out|timeout/i.test(text)) category = 'transport-timeout-warning';
  else if (/connection.*(?:reset|refused)|dns|tls/i.test(text)) category = 'connection-warning';
  else category = 'transport-retry-warning-unclassified';
  return {category, httpStatus};
}
