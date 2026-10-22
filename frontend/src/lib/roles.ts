// Database role names (staff_role enum) and the menu rules from design-system-and-checklist.txt, Part 3.
export type StaffRole =
  | 'super_admin' | 'hospital_admin' | 'doctor' | 'nurse' | 'pharmacist'
  | 'lab_scientist' | 'receptionist' | 'billing_officer' | 'community_health'

export const ROLE_LABEL: Record<StaffRole, string> = {
  super_admin: 'Super Admin', hospital_admin: 'Hospital Admin', doctor: 'Doctor', nurse: 'Nurse',
  pharmacist: 'Pharmacist', lab_scientist: 'Lab Scientist', receptionist: 'Receptionist',
  billing_officer: 'Billing Officer', community_health: 'Community Health Worker',
}

export const isAdmin = (r?: StaffRole | null) => r === 'super_admin' || r === 'hospital_admin'
export const hasRole = (r: StaffRole | null | undefined, ...allowed: StaffRole[]) => !!r && allowed.includes(r)

// The real rule is row-level security in the database; the menu only hides links a role cannot use anyway.
export interface NavItem { path: string; label: string; group: string; roles: 'all' | StaffRole[] }
const A: StaffRole[] = ['super_admin', 'hospital_admin']
export const NAV: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', group: 'Overview', roles: 'all' },
  { path: '/roadmap', label: 'Roadmap', group: 'Overview', roles: 'all' },
  { path: '/registration', label: 'Registration', group: 'Front desk', roles: ['receptionist', 'doctor', 'nurse', ...A] },
  { path: '/queue', label: 'Queue', group: 'Front desk', roles: ['receptionist', 'doctor', 'nurse', ...A] },
  { path: '/appointments', label: 'Appointments', group: 'Front desk', roles: ['receptionist', 'doctor', 'nurse', ...A] },
  { path: '/reminders', label: 'Reminders', group: 'Front desk', roles: ['receptionist', 'doctor', 'nurse', 'community_health', ...A] },
  { path: '/consultation', label: 'Consultation', group: 'Clinical', roles: ['doctor', ...A] },
  { path: '/laboratory', label: 'Laboratory', group: 'Clinical', roles: ['lab_scientist', 'doctor', 'nurse', ...A] },
  { path: '/antenatal-care', label: 'Antenatal Care', group: 'Clinical', roles: ['doctor', 'nurse', 'community_health', ...A] },
  { path: '/pharmacy', label: 'Pharmacy', group: 'Pharmacy', roles: ['pharmacist', ...A] },
  { path: '/inpatient', label: 'Wards and Beds', group: 'Wards', roles: ['doctor', 'nurse', ...A] },
  { path: '/medication-record', label: 'Medication Record', group: 'Wards', roles: ['nurse', 'doctor', ...A] },
  { path: '/billing', label: 'Billing', group: 'Finance', roles: ['billing_officer', 'receptionist', ...A] },
  { path: '/reports', label: 'Reports', group: 'Administration', roles: A },
  { path: '/audit-log', label: 'Audit Log', group: 'Administration', roles: A },
]
export const canSee = (item: NavItem, role: StaffRole | null | undefined) =>
  item.roles === 'all' ? !!role : !!role && item.roles.includes(role)
