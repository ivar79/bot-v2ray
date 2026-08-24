/**
 * V2Ray Aggregator — Cloudflare Worker Entry Point
 */

import { handleWebhookRequest } from "./telegram/webhook";

export interface Env {
  DB: D1Database;

  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
  ADMIN_USER_IDS: string;
}

export default {

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {

    const url = new URL(request.url);


    // Health check
    if (
      url.pathname === "/" &&
      request.method === "GET"
    ) {

      return new Response(
        JSON.stringify({
          status: "ok",
          service: "v2ray-aggregator",
          version: "0.1.0",
          time: new Date().toISOString()
        }),
        {
          headers:{
            "content-type":"application/json"
          }
        }
      );
    }



    // Telegram webhook

    if (
      url.pathname === "/webhook" &&
      request.method === "POST"
    ) {

      try {

        return await handleWebhookRequest(
          request,
          env
        );

      } catch(error){

        console.error(
          "Webhook error:",
          error
        );


        return new Response(
          JSON.stringify({
            ok:false,
            error:"internal error"
          }),
          {
            status:500,
            headers:{
              "content-type":"application/json"
            }
          }
        );

      }

    }



    return new Response(
      "Not Found",
      {
        status:404
      }
    );

  },



  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ){

    try {

      const {
        cleanupOldUpdates
      } = await import("./db/updates");


      await cleanupOldUpdates(
        env.DB,
        90
      );


    } catch(e){

      console.error(
        "cleanup failed",
        e
      );

    }

  }


};