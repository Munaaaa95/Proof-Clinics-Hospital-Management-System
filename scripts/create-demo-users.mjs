// Creates the demo staff accounts (fake people) in Supabase Auth and the staff table. Safe to re-run.
// Usage: node --env-file=.env scripts/create-demo-users.mjs
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.DEMO_PASSWORD
if (!url || !serviceKey || !password) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DEMO_PASSWORD in .env')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

const people = [
  { email: 'admin@proofclinics.test',      code: 'ST-001', name: 'Ada Okafor',     role: 'hospital_admin',  dept: 'Administration', position: 'Hospital Administrator' },
  { email: 'superadmin@proofclinics.test', code: 'ST-000', name: 'Tunde Bello',    role: 'super_admin',     dept: 'IT',             position: 'Super Administrator' },
  { email: 'reception@proofclinics.test',  code: 'ST-010', name: 'Ngozi Eze',      role: 'receptionist',    dept: 'Front Desk',     position: 'Receptionist' },
  { email: 'doctor@proofclinics.test',     code: 'ST-020', name: 'Dr. Femi Adeyemi', role: 'doctor',        dept: 'General',        position: 'Medical Officer' },
  { email: 'doctor2@proofclinics.test',    code: 'ST-021', name: 'Dr. Amara Nwosu', role: 'doctor',         dept: 'General',        position: 'Medical Officer' },
  { email: 'nurse@proofclinics.test',      code: 'ST-030', name: 'Blessing Udo',   role: 'nurse',           dept: 'Nursing',        position: 'Staff Nurse' },
  { email: 'lab@proofclinics.test',        code: 'ST-040', name: 'Ibrahim Musa',   role: 'lab_scientist',   dept: 'Laboratory',     position: 'Medical Laboratory Scientist' },
  { email: 'pharmacy@proofclinics.test',   code: 'ST-050', name: 'Chioma Obi',     role: 'pharmacist',      dept: 'Pharmacy',       position: 'Pharmacist' },
  { email: 'billing@proofclinics.test',    code: 'ST-060', name: 'Seun Adebayo',   role: 'billing_officer', dept: 'Accounts',       position: 'Billing Officer' },
  { email: 'community@proofclinics.test',  code: 'ST-070', name: 'Hauwa Sani',     role: 'community_health', dept: 'Community Health', position: 'Community Health Worker' },
]

const { data: existing, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (listErr) throw listErr
const byEmail = new Map(existing.users.map((u) => [u.email, u]))

for (const p of people) {
  let user = byEmail.get(p.email)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email, password, email_confirm: true, user_metadata: { full_name: p.name },
    })
    if (error) throw error
    user = data.user
  }
  const { error } = await admin.from('staff').upsert({
    id: user.id, staff_code: p.code, full_name: p.name, role: p.role,
    department: p.dept, position: p.position, active: true,
  })
  if (error) throw error
  console.log(`ok  ${p.role.padEnd(16)} ${p.email}`)
}
