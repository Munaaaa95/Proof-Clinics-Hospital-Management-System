// Notification types written by the database (see the notify_roles / notify_staff calls in the migrations).
export const NOTE_TYPES: Record<string, { label: string; icon: string }> = {
  queue: { label: 'New patient waiting', icon: 'person_add' },
  lab_request: { label: 'Lab request', icon: 'biotech' },
  lab_result: { label: 'Lab result finalised', icon: 'biotech' },
  prescription: { label: 'Prescription', icon: 'medication' },
  medication_due: { label: 'Medication due', icon: 'alarm' },
  admission: { label: 'Admission', icon: 'login' },
  discharge: { label: 'Discharge', icon: 'output' },
  low_stock: { label: 'Low stock', icon: 'inventory_2' },
  expiry: { label: 'Drug expiry', icon: 'event_busy' },
  appointment: { label: 'Appointment', icon: 'calendar_month' },
  appointment_reminder: { label: 'Appointment reminder', icon: 'event' },
  anc_follow_up: { label: 'ANC follow-up', icon: 'pregnant_woman' },
}
export const noteIcon = (t: string) => NOTE_TYPES[t]?.icon ?? 'notifications'
export const noteLabel = (t: string) => NOTE_TYPES[t]?.label ?? t.replace(/_/g, ' ')

// The database stores a few links with older names; map them to the real routes.
const LINK_FIX: Record<string, string> = { '/lab': '/laboratory', '/inpatients': '/inpatient' }
export const noteLink = (l: string | null | undefined) => (l ? LINK_FIX[l] ?? l : null)
