import { query } from '../db/pool.js';
import { config } from '../config.js';

function nameFromEmail(email) {
  const local = email.split('@')[0];
  const cleaned = local.replace(/[._-]+/g, ' ').trim();
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) || email;
}

export async function seedStaff() {
  for (const email of config.teacherEmails) {
    await query(
      `INSERT INTO users (email, name, role)
       VALUES ($1, $2, 'teacher')
       ON CONFLICT (email) DO UPDATE SET role = 'teacher'`,
      [email, nameFromEmail(email)],
    );
  }
  for (const email of config.adminEmails) {
    await query(
      `INSERT INTO users (email, name, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (email) DO UPDATE SET role = 'admin'`,
      [email, nameFromEmail(email)],
    );
  }
  if (config.teacherEmails.length || config.adminEmails.length) {
    console.log(`Seeded ${config.teacherEmails.length} teacher(s) and ${config.adminEmails.length} admin(s).`);
  }
}
