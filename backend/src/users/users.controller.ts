import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import type { UserRole } from '@prisma/client';
import { CurrentActor, Roles, type Actor } from '../auth/auth.guard';
import { UsersService } from './users.service';
import { MIN_PASSWORD_LENGTH } from './user-rules';

/**
 * User accounts and their roles and gates. ADMIN only, every route.
 * Copied from eparking backend/src/staff/staff.controller.ts and adapted.
 * No route returns a password hash.
 */

const ROLES: UserRole[] = ['ADMIN', 'ENTRY_OPERATOR', 'PAYMENT_OPERATOR', 'EXIT_OPERATOR'];
const present = (field: string) => ValidateIf((o: Record<string, unknown>) => o[field] !== undefined);

class CreateUserDto {
  @IsString() @MaxLength(64)
  username!: string;

  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;

  @IsIn(ROLES)
  role!: UserRole;

  // Required for an operator, absent or null for an admin (checked in the service).
  @ValidateIf((o: CreateUserDto) => o.gateId !== undefined && o.gateId !== null) @IsUUID()
  gateId?: string | null;

  @IsString() @MinLength(MIN_PASSWORD_LENGTH) @MaxLength(256)
  password!: string;
}

/** No username, no site, no password: see planUserUpdate. */
class UpdateUserDto {
  @present('name') @IsString() @MinLength(1) @MaxLength(120)
  name?: string;

  @present('role') @IsIn(ROLES)
  role?: UserRole;

  @ValidateIf((o: UpdateUserDto) => o.gateId !== undefined && o.gateId !== null) @IsUUID()
  gateId?: string | null;

  @present('isActive') @IsBoolean()
  isActive?: boolean;
}

class SetPasswordDto {
  @IsString() @MinLength(MIN_PASSWORD_LENGTH) @MaxLength(256)
  password!: string;
}

@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles('ADMIN')
  @Get()
  list() {
    return this.users.list();
  }

  @Roles('ADMIN')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.get(id);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() body: CreateUserDto, @CurrentActor() actor: Actor) {
    return this.users.create(body, actor.id);
  }

  /**
   * Rename, change role or gate, or deactivate. A role, gate or deactivation
   * change ends the user's sessions at once (token_version).
   */
  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateUserDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.users.update(id, body, actor.id);
  }

  /** A soft delete. See docs/api.md. */
  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentActor() actor: Actor) {
    return this.users.remove(id, actor.id);
  }

  @Roles('ADMIN')
  @Post(':id/password')
  @HttpCode(200)
  setPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SetPasswordDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.users.setPassword(id, body.password, actor.id);
  }
}
