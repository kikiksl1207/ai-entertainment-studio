import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatService } from './chat.service';

type CreateSessionBody = {
  artistId?: string;
  chatPersonaId?: string;
};

type CreateMessageBody = {
  body?: string;
  messageType?: string;
  chatFeatureOrderId?: string;
};

type CreateFeatureOrderBody = {
  chatSessionId?: string;
  chatFeatureProductId?: string;
  idempotencyKey?: string;
};

type GenerateChatMessageBody = {
  body?: string;
  chatFeatureOrderId?: string;
};

type PreflightChatMessageBody = {
  body?: string;
  mode?: string;
};

@Controller()
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('chat/sessions')
  createSession(@CurrentUser() user: AuthUser, @Body() body: CreateSessionBody) {
    return this.chatService.createSession(user.id, {
      artistId: this.requireField(body?.artistId, 'artistId'),
      chatPersonaId: body?.chatPersonaId,
    });
  }

  @Get('chat/sessions')
  getSessions(@CurrentUser() user: AuthUser) {
    return this.chatService.getSessions(user.id);
  }

  @Get('chat/persona-seed-policy')
  getPersonaSeedPolicy() {
    return this.chatService.getPersonaSeedPolicy();
  }

  @Get('chat/persona-trait-catalog')
  getPersonaTraitCatalog() {
    return this.chatService.getPersonaTraitCatalog();
  }

  @Get('chat/character-catalog')
  getCharacterChatCatalog(
    @Query('artistId') artistId?: string,
    @Query('artistSlug') artistSlug?: string,
  ) {
    return this.chatService.getCharacterChatCatalog({ artistId, artistSlug });
  }

  @Get('chat/starter-prompts')
  getStarterPrompts(
    @Query('artistId') artistId?: string,
    @Query('artistSlug') artistSlug?: string,
  ) {
    return this.chatService.getStarterPrompts({ artistId, artistSlug });
  }

  @Get('chat/sessions/:sessionId/messages')
  getMessages(@CurrentUser() user: AuthUser, @Param('sessionId') sessionId: string) {
    return this.chatService.getMessages(user.id, sessionId);
  }

  @Post('chat/sessions/:sessionId/messages')
  createMessage(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
    @Body() body: CreateMessageBody,
  ) {
    return this.chatService.createMessage(user.id, sessionId, {
      body: this.requireField(body?.body, 'body'),
      messageType: body?.messageType,
      chatFeatureOrderId: body?.chatFeatureOrderId,
    });
  }

  @Post('chat/sessions/:sessionId/generate')
  generateMessage(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
    @Body() body: GenerateChatMessageBody,
  ) {
    return this.chatService.generateMessage(user.id, sessionId, {
      body: this.requireField(body?.body, 'body'),
      chatFeatureOrderId: body?.chatFeatureOrderId,
    });
  }

  @Post('chat/sessions/:sessionId/preflight')
  preflightMessage(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
    @Body() body: PreflightChatMessageBody,
  ) {
    return this.chatService.preflightMessage(user.id, sessionId, {
      body: body?.body,
      mode: body?.mode,
    });
  }

  @Get('chat/provider-ops-status')
  getProviderOpsStatus(@CurrentUser() user: AuthUser) {
    return this.chatService.getProviderOpsStatus(user.id);
  }

  @Get('chat-feature-products')
  getFeatureProducts() {
    return this.chatService.getFeatureProducts();
  }

  @Post('chat-feature-orders/preview')
  previewFeatureOrder(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateFeatureOrderBody,
  ) {
    return this.chatService.previewFeatureOrder(user.id, {
      chatSessionId: this.requireField(body?.chatSessionId, 'chatSessionId'),
      chatFeatureProductId: this.requireField(
        body?.chatFeatureProductId,
        'chatFeatureProductId',
      ),
    });
  }

  @Post('chat-feature-orders')
  createFeatureOrder(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: CreateFeatureOrderBody,
  ) {
    return this.chatService.createFeatureOrder(user.id, {
      chatSessionId: this.requireField(body?.chatSessionId, 'chatSessionId'),
      chatFeatureProductId: this.requireField(
        body?.chatFeatureProductId,
        'chatFeatureProductId',
      ),
      idempotencyKey: body?.idempotencyKey ?? idempotencyKeyHeader,
    });
  }

  private requireField(value: string | undefined, fieldName: string) {
    if (!value) {
      throw new BadRequestException(`${fieldName} is required`);
    }

    return value;
  }
}
