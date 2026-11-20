# "Add Book" Apple Shortcut

Share a TikTok link, a screenshot or some text to **Add Book**. It sends what you shared to the `capture` edge function and
opens the confirmation page, where you tap **Next Up**, **To-Read** or **Skip** for each book it found.

Shortcuts can't be shipped as a file from here (they're signed per Apple ID), so build it once by hand. It takes about five minutes.

## What you need

- `https://<project-ref>.supabase.co/functions/v1/capture`: your function URL
- your `CAPTURE_TOKEN`, the value you set with `supabase secrets set`

## Build it

Open **Shortcuts** → **+**, name it **Add Book**, then add these actions in order.

1. **Shortcut details** (the ⓘ button): turn on **Show in Share Sheet**. Under *Receive*, choose **Images, Text and URLs**.
   Set *If there's no input* to **Get Clipboard**.

2. **Get Images from Input** (Input: *Shortcut Input*).

3. **If** *Images* **has any value**

   1. **Convert Image** *Images* to **JPEG** (Quality ~80%; turn off *Preserve Metadata*).
   2. **Resize Image** *Converted Image* to width **1290** (height: Auto). This keeps it under the 5 MB limit.
   3. **Base64 Encode** *Resized Image* (Line Breaks: **None**).
   4. **Get Contents of URL**: your function URL.
      - Method: **POST**
      - Headers: `x-capture-token` = *your token*
      - Request Body: **JSON**, one field: `image` (Text) = *Base64 Encoded*

4. **Otherwise**

   1. **Get Contents of URL**: your function URL.
      - Method: **POST**
      - Headers: `x-capture-token` = *your token*
      - Request Body: **JSON**, one field: `text` (Text) = *Shortcut Input*

5. **End If**

6. **Get Dictionary Value** for key `confirm_url` in *If Result*.

7. **Open URLs** *Dictionary Value*.

## Using it

- **TikTok:** Share → *More* (or scroll the app row) → **Add Book**. Pin it to the top of the share sheet for one tap. The
  caption is read through TikTok's oEmbed endpoint. If the caption doesn't name the book, take a screenshot of the frame
  that shows it and share that instead.
- **Screenshot:** from the screenshot preview or Photos, Share → **Add Book**. Claude reads the covers and on-screen text.
- **Anything else:** copy a title, then run Add Book from the home screen or widget (it falls back to the clipboard).

The first time the confirmation page opens in Safari it asks you to sign in (magic link). After that the session sticks.

## Troubleshooting

| What you see | Fix |
| --- | --- |
| `Bad or missing x-capture-token` | The header name or token doesn't match the `CAPTURE_TOKEN` secret. |
| `Screenshot is over 5 MB` | Make sure the Convert Image (JPEG) and Resize Image steps run before Base64 Encode. |
| Page says *No books found* | Search for the book by name on that page; it's added the same way. |
| Opens a blank `/confirm/…` page | `APP_URL` secret is missing or wrong, or the web host isn't rewriting routes to `index.html`. |
