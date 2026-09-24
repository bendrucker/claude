#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/smtp.ts <<'TS'
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const socket = await Bun.connect({
    hostname: "smtp.internal.example",
    port: 25,
    socket: { data() {} },
  });
  socket.write(`MAIL TO:<${to}>\r\nSUBJECT:${subject}\r\n\r\n${body}\r\n.\r\n`);
  socket.end();
}
TS
cat > src/reminders.ts <<'TS'
import { sendEmail } from "./smtp";

export interface Invoice {
  id: string;
  customerEmail: string;
  dueDate: string;
  paid: boolean;
}

export async function sendReminders(invoices: Invoice[], today: string): Promise<number> {
  const overdue = invoices.filter((invoice) => invoice.dueDate < today);
  for (const invoice of overdue) {
    await sendEmail(invoice.customerEmail, `Invoice ${invoice.id} is overdue`, "Please pay.");
  }
  return overdue.length;
}
TS
