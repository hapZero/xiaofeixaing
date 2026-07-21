import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  check() {
    return { service: "xiaofeixiang-api", status: "ok", timestamp: new Date().toISOString() };
  }
}
