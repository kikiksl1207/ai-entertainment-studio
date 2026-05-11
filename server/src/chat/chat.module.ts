import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatLlmProviderAdapter } from './llm-provider.adapter';
import { ChatService } from './chat.service';

@Module({
  controllers: [ChatController],
  providers: [ChatService, ChatLlmProviderAdapter],
})
export class ChatModule {}
