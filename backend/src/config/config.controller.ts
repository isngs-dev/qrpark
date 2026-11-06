import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { GateDirection } from '@prisma/client';
import { CurrentActor, Roles, type Actor } from '../auth/auth.guard';
import { ConfigService } from './config.service';
import { MAX_KOBO, MAX_VALIDITY_HOURS, MIN_VALIDITY_HOURS } from './config-rules';

/**
 * Admin configuration: categories and prices, settings, gates. ADMIN only,
 * every route. Copied from eparking backend/src/config/config.controller.ts
 * and adapted; see docs/api.md.
 *
 * Optional fields use ValidateIf(present) rather than IsOptional: IsOptional
 * also lets `null` through, and `{ "priceKobo": null }` must be a 400, not a
 * silently ignored field.
 */

const present = (field: string) => ValidateIf((o: Record<string, unknown>) => o[field] !== undefined);

class CreateCategoryDto {
  @IsString() @MaxLength(32)
  code!: string;

  @IsString() @MaxLength(100)
  name!: string;

  // A JSON number that is a whole number of kobo. "500" (a string) and 1.5
  // are refused; there is no conversion.
  @IsInt() @Min(1) @Max(MAX_KOBO)
  priceKobo!: number;
}

class UpdateCategoryDto {
  @present('name') @IsString() @MaxLength(100)
  name?: string;

  @present('priceKobo') @IsInt() @Min(1) @Max(MAX_KOBO)
  priceKobo?: number;

  @present('isActive') @IsBoolean()
  isActive?: boolean;
}

class UpdateSettingsDto {
  @present('displayName') @IsString() @MaxLength(200)
  displayName?: string;

  @present('validityHours') @IsInt() @Min(MIN_VALIDITY_HOURS) @Max(MAX_VALIDITY_HOURS)
  validityHours?: number;

  // null or "" clears the line.
  @ValidateIf((o: UpdateSettingsDto) => o.receiptOrgName !== undefined && o.receiptOrgName !== null)
  @IsString() @MaxLength(200)
  receiptOrgName?: string | null;

  @ValidateIf((o: UpdateSettingsDto) => o.receiptContactLine !== undefined && o.receiptContactLine !== null)
  @IsString() @MaxLength(200)
  receiptContactLine?: string | null;
}

class CreateGateDto {
  @IsString() @MaxLength(32)
  code!: string;

  @IsString() @MaxLength(100)
  name!: string;

  @IsIn(['ENTRY', 'EXIT'])
  direction!: GateDirection;
}

class UpdateGateDto {
  @present('name') @IsString() @MaxLength(100)
  name?: string;

  @present('isActive') @IsBoolean()
  isActive?: boolean;
}

@Controller('admin')
export class ConfigController {
  constructor(private readonly config: ConfigService) {}

  @Roles('ADMIN')
  @Get('categories')
  listCategories() {
    return this.config.listCategories();
  }

  @Roles('ADMIN')
  @Post('categories')
  createCategory(@Body() body: CreateCategoryDto, @CurrentActor() actor: Actor) {
    return this.config.createCategory(body, actor.id);
  }

  @Roles('ADMIN')
  @Patch('categories/:id')
  updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateCategoryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.config.updateCategory(id, body, actor.id);
  }

  @Roles('ADMIN')
  @Get('settings')
  getSettings() {
    return this.config.getSettings();
  }

  @Roles('ADMIN')
  @Patch('settings')
  updateSettings(@Body() body: UpdateSettingsDto, @CurrentActor() actor: Actor) {
    return this.config.updateSettings(body, actor.id);
  }

  @Roles('ADMIN')
  @Get('gates')
  listGates() {
    return this.config.listGates();
  }

  @Roles('ADMIN')
  @Post('gates')
  createGate(@Body() body: CreateGateDto, @CurrentActor() actor: Actor) {
    return this.config.createGate(body, actor.id);
  }

  @Roles('ADMIN')
  @Patch('gates/:id')
  updateGate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateGateDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.config.updateGate(id, body, actor.id);
  }
}
