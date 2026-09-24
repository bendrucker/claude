const sent: string[] = [];
await sendReminders(invoices, "2026-01-01", async (to) => { sent.push(to); });
