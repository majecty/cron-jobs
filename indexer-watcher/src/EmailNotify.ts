import * as sgMail from "@sendgrid/mail";
import { getConfig, haveConfig } from "./util";

export class EmailClient {
    private from: string;

    public constructor() {
        if (!haveConfig("sendgrid_api_key")) {
            if (process.env.NODE_ENV === "production") {
                throw Error(`SENDGRID_API_KEY not found`);
            } else {
                console.log("SENDGRID_API_KEY is null");
            }
        }
        sgMail.setApiKey(getConfig("sendgrid_api_key"));
        this.from = "no-reply+indexer-watcher@devop.codechain.io";
    }

    public async sendAnnouncement(email: string, title: string, content: string): Promise<void> {
        // FIXME:
        await this.send(email, title, content);
    }

    private async send(to: string, subject: string, text: string) {
        if (process.env.NODE_ENV === "test") {
            return;
        }
        console.log(` Send an email to ${to}`);
        console.log(` subject: ${subject}`);
        console.log(` text: ${text}`);

        const { from } = this;
        return sgMail.send({
            from,
            to,
            subject,
            text,
        });
    }
}
