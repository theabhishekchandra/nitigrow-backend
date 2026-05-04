/**
 * NitiGrow RBAC Permissions Map
 * ─────────────────────────────
 * Central source of truth for role-based access control.
 * Used by:
 *   - Backend route middleware (requireRole)
 *   - GET /api/auth/permissions endpoint (frontend sidebar filtering)
 *
 * Each key is a capability area. The value is an array of roles allowed.
 * 'owner' always has full access.
 */

const PERMISSIONS = {
  // Inbox — messaging agents
  inbox:           ['owner', 'manager', 'sales_agent', 'support_agent'],

  // Contacts
  'contacts.read':  ['owner', 'manager', 'sales_agent', 'support_agent', 'campaign_manager', 'analyst'],
  'contacts.write': ['owner', 'manager', 'sales_agent'],

  // Templates
  'templates.read':  ['owner', 'manager', 'campaign_manager', 'sales_agent', 'support_agent'],
  'templates.write': ['owner', 'manager', 'campaign_manager'],

  // Campaigns
  'campaigns.read':  ['owner', 'manager', 'campaign_manager'],
  'campaigns.write': ['owner', 'manager', 'campaign_manager'],

  // Chatbot Flows
  'chatbotFlows.read':  ['owner', 'manager'],
  'chatbotFlows.write': ['owner', 'manager'],

  // Analytics
  analytics: ['owner', 'manager', 'analyst'],

  // Team Management
  team: ['owner', 'manager'],

  // Billing & Subscription
  billing: ['owner', 'accountant'],

  // Settings
  settings: ['owner', 'manager'],

  // AI features
  ai: ['owner', 'manager', 'sales_agent', 'support_agent'],

  // Dashboard — everyone can see their own dashboard
  dashboard: ['owner', 'manager', 'sales_agent', 'support_agent', 'campaign_manager', 'analyst', 'accountant'],
};

/**
 * Get all permissions for a given role.
 * Returns an object like { inbox: true, billing: false, ... }
 */
const getPermissionsForRole = (role) => {
  const result = {};
  for (const [capability, allowedRoles] of Object.entries(PERMISSIONS)) {
    result[capability] = allowedRoles.includes(role);
  }
  return result;
};

/**
 * Get sidebar-visible pages for a role.
 * Maps capabilities to frontend route paths.
 */
const getSidebarForRole = (role) => {
  const capabilityToRoute = {
    dashboard: '/dashboard',
    inbox: '/inbox',
    'contacts.read': '/contacts',
    'templates.read': '/templates',
    'campaigns.read': '/campaigns',
    analytics: '/analytics',
    'chatbotFlows.read': '/chatbot-flows',
    team: '/team',
    billing: '/billing',
    settings: '/settings',
  };

  return Object.entries(capabilityToRoute)
    .filter(([cap]) => PERMISSIONS[cap]?.includes(role))
    .map(([, route]) => route);
};

module.exports = { PERMISSIONS, getPermissionsForRole, getSidebarForRole };
