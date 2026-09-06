export function FormMessage({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return <div className={`form-message ${error ? "form-message--error" : "form-message--success"}`}>{error ?? message}</div>;
}
