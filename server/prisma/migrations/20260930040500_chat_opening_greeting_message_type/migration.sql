ALTER TABLE chat_messages
  DROP CONSTRAINT chat_messages_message_type_check;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'audio', 'video', 'system', 'opening_greeting'));
