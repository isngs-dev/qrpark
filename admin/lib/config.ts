import { api } from './api';
import type { Category, Gate, Settings } from './config-types';

/**
 * Reading the site configuration. Server-only (the session cookies).
 * Adapted from eparking admin/lib/config.ts (359c0c1): qrpark's admin routes;
 * no pricing rules, pass plans or devices.
 */

export const getCategories = () => api<Category[]>('/admin/categories');

export const getSettings = () => api<Settings>('/admin/settings');

export const getGates = () => api<Gate[]>('/admin/gates');
