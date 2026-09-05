import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { PartyType, SubledgerResponse } from '@finstat/shared';

import { PartiesService } from './parties.service';
import { ParsePartyTypePipe } from './party-type.pipe';
import { CompanyAccessGuard } from '../common/guards';
import { EditableYearGuard, FinancialYearScopeGuard } from '../financial-years/year-scope.guard';
import { CurrentUser, RequireCompanyRole } from '../common/decorators';

class PartyDtoIn {
  @IsString() @MinLength(1) @MaxLength(40) code!: string;
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(40) vatNumber?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) creditLimit?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdatePartyDto {
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(40) vatNumber?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) creditLimit?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class BalanceDtoIn {
  @IsUUID() partyId!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) current?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) days30?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) days60?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) days90?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) days120Plus?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) total?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class SaveBalancesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BalanceDtoIn)
  balances!: BalanceDtoIn[];
}

class PasteListingDto {
  @IsString() text!: string;
}

@ApiTags('debtors-creditors')
@Controller('companies/:companyId/years/:yearId/subledger')
@UseGuards(CompanyAccessGuard, FinancialYearScopeGuard)
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Get()
  get(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @Query('type', new ParsePartyTypePipe()) type: PartyType,
  ): Promise<SubledgerResponse> {
    return this.parties.getSubledger(companyId, yearId, type);
  }

  @Post('parties')
  @RequireCompanyRole('PREPARER')
  createParty(
    @Param('companyId') companyId: string,
    @CurrentUser('id') userId: string,
    @Query('type', new ParsePartyTypePipe()) type: PartyType,
    @Body() dto: PartyDtoIn,
  ) {
    return this.parties.createParty(companyId, userId, type, dto);
  }

  @Patch('parties/:partyId')
  @RequireCompanyRole('PREPARER')
  updateParty(
    @Param('companyId') companyId: string,
    @Param('partyId') partyId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdatePartyDto,
  ) {
    return this.parties.updateParty(companyId, partyId, userId, dto);
  }

  @Delete('parties/:partyId')
  @RequireCompanyRole('ADMIN')
  removeParty(
    @Param('companyId') companyId: string,
    @Param('partyId') partyId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.parties.removeParty(companyId, partyId, userId);
  }

  @Put('balances')
  @UseGuards(EditableYearGuard)
  @RequireCompanyRole('PREPARER')
  saveBalances(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
    @Query('type', new ParsePartyTypePipe()) type: PartyType,
    @Body() dto: SaveBalancesDto,
  ): Promise<SubledgerResponse> {
    return this.parties.saveBalances(companyId, yearId, type, userId, dto.balances);
  }

  @Post('paste')
  @UseGuards(EditableYearGuard)
  @RequireCompanyRole('PREPARER')
  paste(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
    @Query('type', new ParsePartyTypePipe()) type: PartyType,
    @Body() dto: PasteListingDto,
  ): Promise<SubledgerResponse> {
    return this.parties.pasteListing(companyId, yearId, type, userId, dto.text);
  }
}
