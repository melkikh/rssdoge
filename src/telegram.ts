export class Telegram {
  private chatID: string;
  private token: string;

  constructor(props: { token: string; chatID: string }) {
    this.chatID = props.chatID;
    this.token = props.token;
  }

  async sendMessage(message: string): Promise<void> {
    const data = {
      chat_id: this.chatID,
      text: message,
      parse_mode: "html",
    };
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/sendMessage`,
      {
        method: "post",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      },
    );
    if (response.status !== 200) {
      const errText = await response.text();
      throw new Error(`Failed to sent message to Telegram: ${errText}`);
    }
  }
}
