import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatLlmProviderAdapter } from './llm-provider.adapter';
import { ChatService } from './chat.service';
import { PremiumChatRoomsReadController } from './premium-chat-rooms-read.controller';

@Module({
  controllers: [ChatController, PremiumChatRoomsReadController],
  providers: [ChatService, ChatLlmProviderAdapter],
})
export class ChatModule {}
