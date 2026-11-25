// Keep in step with MIN_SECRET_LENGTH in backend/src/services/redact.js: the live log masks
// configured passwords and secret variables only from this length up.
export const MIN_SECRET_LENGTH = 6
export const isShortSecret = (v) => !!v && v.length < MIN_SECRET_LENGTH
export const SHORT_SECRET_WARNING = `Shorter than ${MIN_SECRET_LENGTH} characters: will not be hidden in logs.`
