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
          env,
          undefined,
          ctx
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

      const {
        fetchAllSubscriptions
      } = await import("./ingest/subscription");

      const {
        createTelegramBotAPI
      } = await import("./telegram/api");


      await cleanupOldUpdates(
        env.DB,
        90
      );

      console.log("[scheduled] Starting subscription fetch cycle");
      const fetchResult = await fetchAllSubscriptions(
        env.DB,
        env.TELEGRAM_BOT_TOKEN ? createTelegramBotAPI(env.TELEGRAM_BOT_TOKEN) : undefined
      );
      console.log("[scheduled] Fetch complete:", JSON.stringify(fetchResult));


    } catch(e){

      console.error(
        "cleanup failed",
        e
      );

    }

  }


};