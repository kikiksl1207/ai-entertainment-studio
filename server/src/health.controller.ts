import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'lumina-stage-api',
      timestamp: new Date().toISOString(),
      commit: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null,
    };
  }
}
