import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { buildArtistUrlKnowledgePreviewFixture } from './artist-url-knowledge-preview-fixture';
import { ChatService } from './chat.service';
import { buildPremiumChatRefundStatusPreviewFixture } from './premium-chat-refund-status-preview-fixture';

type PremiumRoomListQuery = {
  artistSlug?: string;
  status?: string;
  take?: string;
  cursor?: string;
};

@Controller()
export class PremiumChatRoomsReadController {
  constructor(private readonly chatService: ChatService) {}

  @Get('chat/premium-rooms/refund-status-preview-fixture')
  getPremiumRoomRefundStatusPreviewFixture() {
    return buildPremiumChatRefundStatusPreviewFixture();
  }

  @Get('chat/artist-url-knowledge-preview-fixture')
  getArtistUrlKnowledgePreviewFixture() {
    return buildArtistUrlKnowledgePreviewFixture();
  }

  @Get('chat/premium-rooms')
  getPremiumRooms(@Query() query: PremiumRoomListQuery) {
    return this.chatService.getPremiumRoomList({
      artistSlug: query.artistSlug,
      status: query.status,
      take: this.optionalPositiveInt(query.take),
      cursor: query.cursor,
    });
  }

  @Get('chat/me/premium-rooms')
  @UseGuards(JwtAuthGuard)
  getMyPremiumRooms(
    @CurrentUser() user: AuthUser,
    @Query() query: PremiumRoomListQuery,
  ) {
    return this.chatService.getMyPremiumRoomList(user.id, {
      artistSlug: query.artistSlug,
      status: query.status,
      take: this.optionalPositiveInt(query.take),
      cursor: query.cursor,
    });
  }

  @Get('chat/me/premium-rooms/:roomId/status')
  @UseGuards(JwtAuthGuard)
  getMyPremiumRoomStatus(
    @CurrentUser() user: AuthUser,
    @Param('roomId') roomId: string,
  ) {
    return this.chatService.getMyPremiumRoomStatus(user.id, roomId);
  }

  @Get('creator-studio/premium-chat/rooms/:roomId/status')
  @UseGuards(JwtAuthGuard)
  getArtistPremiumRoomStatus(
    @CurrentUser() user: AuthUser,
    @Param('roomId') roomId: string,
  ) {
    return this.chatService.getArtistPremiumRoomStatus(user.id, roomId);
  }

  private optionalPositiveInt(value: string | undefined) {
    if (value === undefined) {
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException({
        code: 'PREMIUM_CHAT_ROOM_TAKE_INVALID',
        message: 'take must be a positive integer',
        messageKey: 'chat.premiumRoom.invalidTake',
      });
    }

    return parsed;
  }
}
