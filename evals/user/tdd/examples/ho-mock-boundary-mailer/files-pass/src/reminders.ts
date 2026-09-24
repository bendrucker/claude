export async function sendReminders(
  invoices: Invoice[],
  today: string,
  send: Send = sendEmail,
): Promise<number> {
