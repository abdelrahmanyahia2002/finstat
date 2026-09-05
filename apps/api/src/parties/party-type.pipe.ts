import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { PARTY_TYPES, type PartyType } from '@finstat/shared';

/** Turns the `?type=` query string into a PartyType, or says why it cannot. */
@Injectable()
export class ParsePartyTypePipe implements PipeTransform<string, PartyType> {
  transform(value: string): PartyType {
    const upper = (value ?? '').toUpperCase();
    if ((PARTY_TYPES as readonly string[]).includes(upper)) return upper as PartyType;
    throw new BadRequestException('Ask for either DEBTOR or CREDITOR.');
  }
}
