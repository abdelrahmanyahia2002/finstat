import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  NOTE_KINDS,
  STATEMENT_SECTIONS,
  type NoteDto,
  type NoteKind,
  type StatementSection,
} from '@finstat/shared';

import { NotesService } from './notes.service';
import { CompanyAccessGuard } from '../common/guards';
import { EditableYearGuard, FinancialYearScopeGuard } from '../financial-years/year-scope.guard';
import { CurrentUser, RequireCompanyRole } from '../common/decorators';

class NoteLineDtoIn {
  @IsString() @MinLength(1) @MaxLength(300) label!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) currentAmount?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) priorAmount?: number | null;
  @IsOptional() @IsBoolean() isSubtotal?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsUUID() accountId?: string | null;
}

class NoteDtoIn {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsOptional() @IsIn(NOTE_KINDS) kind?: NoteKind;
  @IsOptional() @IsIn(STATEMENT_SECTIONS) section?: StatementSection;
  @IsOptional() @IsString() @MaxLength(20000) body?: string;
  @IsOptional() @IsInt() @Min(1) number?: number;
  @IsOptional() @IsInt() sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NoteLineDtoIn)
  lines?: NoteLineDtoIn[];
}

class UpdateNoteDto {
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @IsIn(NOTE_KINDS) kind?: NoteKind;
  @IsOptional() @IsIn(STATEMENT_SECTIONS) section?: StatementSection;
  @IsOptional() @IsString() @MaxLength(20000) body?: string;
  @IsOptional() @IsInt() @Min(1) number?: number;
  @IsOptional() @IsInt() sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NoteLineDtoIn)
  lines?: NoteLineDtoIn[];
}

class GenerateNotesDto {
  @IsOptional() @IsBoolean() includePolicies?: boolean;
}

@ApiTags('notes')
@Controller('companies/:companyId/years/:yearId/notes')
@UseGuards(CompanyAccessGuard, FinancialYearScopeGuard)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@Param('yearId') yearId: string): Promise<NoteDto[]> {
    return this.notes.list(yearId);
  }

  @Post()
  @UseGuards(EditableYearGuard)
  @RequireCompanyRole('PREPARER')
  create(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: NoteDtoIn,
  ) {
    return this.notes.create(companyId, yearId, userId, dto);
  }

  @Post('generate')
  @UseGuards(EditableYearGuard)
  @RequireCompanyRole('PREPARER')
  generate(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: GenerateNotesDto,
  ) {
    return this.notes.generate(companyId, yearId, userId, dto);
  }

  @Patch(':noteId')
  @UseGuards(EditableYearGuard)
  @RequireCompanyRole('PREPARER')
  update(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @Param('noteId') noteId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateNoteDto,
  ) {
    return this.notes.update(companyId, yearId, noteId, userId, dto);
  }

  @Delete(':noteId')
  @UseGuards(EditableYearGuard)
  @RequireCompanyRole('PREPARER')
  @HttpCode(204)
  remove(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @Param('noteId') noteId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.notes.remove(companyId, yearId, noteId, userId);
  }
}
