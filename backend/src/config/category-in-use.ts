import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * A vehicle category a payment can use: it exists, and it is in use.
 *
 * Copied from eparking backend/src/config/category-in-use.ts. A retired
 * category is told apart from a code nobody configured: the app may still
 * offer one retired since, and the operator must be told it was retired.
 */
export function assertCategoryInUse<T extends { isActive: boolean; name: string }>(
  code: string,
  category: T | null,
): asserts category is T {
  if (!category) throw new NotFoundException(`Unknown vehicle category "${code}"`);
  if (category.isActive) return;
  throw new BadRequestException(
    `Vehicle category "${category.name}" (${code}) is retired. Choose a category that is in use, ` +
      'or return this one to service in the Admin Portal.',
  );
}
