import { api } from './api';
import type { UserAccount } from './users-types';

/**
 * Reading accounts. Server-only. Adapted from eparking admin/lib/staff.ts
 * (359c0c1): qrpark's /admin/users (deleted accounts are not listed); no
 * dashboard (5c).
 */
export const getUsers = () => api<UserAccount[]>('/admin/users');
