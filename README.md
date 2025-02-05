# directus-extension-async-import

Custom endpoints to handle large file imports into Directus.
This is needed in cases where your request may be aborted by a middleware server after the timeout.
For example, Cloudflare timeout is 100 seconds (1min and 40secs)

## Usage

- Upload a JSON or CSV file using a Form to the route `POST /async-import/:collection` where collection is the name of the collection where the data should go. These request should be authenticated.
- Check the status of the imports done so far by using the route `GET /async-import`. If you are Admin, it will list all running imports, if you are a user, it will only show the ones you have started.

## Example (Node.js)

```js
import axios from "axios";
import FormData from "form-data";
import fs from "node:fs";

const directus = axios.create({
  baseUrl: "https://example.directus.app",
  headers: { Authorization: "Bearer example" },
});

async function start() {
  const form = new FormData();
  form.append("file", fs.createReadStream("/path/to/file.json"));

  await axios.post("/async-import/example", form);

  const status = await axios.get("/async-import/").then((r) => r.data);
}
```
