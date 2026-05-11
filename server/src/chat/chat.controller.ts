import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
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
