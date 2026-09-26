const SESSION_COOKIE = "science_session";
const SESSION_DAYS = 7;

export default {
  async fetch(request, env) {
    try {
      await initDatabase(env);

      const url = new URL(request.url);
      const path = url.pathname;

      // API
      if (path.startsWith("/api/")) {
        return handleAPI(request, env, path);
      }

      // R2 media
      if (path.startsWith("/media/")) {
        return serveMedia(request, env, path);
      }

      // Frontend assets
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response("3D Science Library is online.", {
        headers: {
          "content-type": "text/plain"
        }
      });

    } catch (error) {
      console.error(error);

      return json({
        error: "Internal server error"
      }, 500);
    }
  }
};


/* =========================
   DATABASE INITIALIZATION
========================= */

async function initDatabase(env) {

  if (!env.DB) {
    throw new Error("D1 database binding DB is missing.");
  }

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      created_at INTEGER NOT NULL
    )
  `).run();


  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      chapter TEXT NOT NULL,
      model_url TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run();


  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS pdfs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      chapter TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run();


  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_id TEXT,
      created_at INTEGER NOT NULL
    )
  `).run();
}


/* =========================
   API ROUTER
========================= */

async function handleAPI(request, env, path) {

  const method = request.method;


  /* PUBLIC MODELS */

  if (
    path === "/api/models" &&
    method === "GET"
  ) {

    const { results } =
      await env.DB.prepare(`
        SELECT
          id,
          title,
          subject,
          chapter,
          model_url AS modelUrl
        FROM models
        ORDER BY id DESC
      `).all();

    return json({
      models: results
    });
  }


  /* PUBLIC PDFS */

  if (
    path === "/api/pdfs" &&
    method === "GET"
  ) {

    const { results } =
      await env.DB.prepare(`
        SELECT
          id,
          title,
          chapter,
          url
        FROM pdfs
        ORDER BY id DESC
      `).all();

    return json({
      pdfs: results
    });
  }


  /* SIGNUP */

  if (
    path === "/api/auth/signup" &&
    method === "POST"
  ) {
    return signup(request, env);
  }


  /* LOGIN */

  if (
    path === "/api/auth/login" &&
    method === "POST"
  ) {
    return login(request, env);
  }


  /* LOGOUT */

  if (
    path === "/api/auth/logout" &&
    method === "POST"
  ) {

    return new Response(
      JSON.stringify({
        ok: true
      }),
      {
        headers: {
          "content-type":
            "application/json",

          "set-cookie":
            `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
        }
      }
    );
  }


  /* CURRENT USER */

  if (
    path === "/api/me" &&
    method === "GET"
  ) {

    const user =
      await getCurrentUser(
        request,
        env
      );

    if (!user) {
      return json({
        error: "Not authenticated"
      }, 401);
    }

    return json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  }


  /* =========================
     ADMIN
  ========================= */

  const user =
    await getCurrentUser(
      request,
      env
    );


  /* ADMIN STATS */

  if (
    path === "/api/admin/stats" &&
    method === "GET"
  ) {

    if (!isAdmin(user, env)) {
      return json({
        error: "Admin access required"
      }, 403);
    }


    const models =
      await env.DB
        .prepare(
          "SELECT COUNT(*) AS count FROM models"
        )
        .first();


    const pdfs =
      await env.DB
        .prepare(
          "SELECT COUNT(*) AS count FROM pdfs"
        )
        .first();


    const users =
      await env.DB
        .prepare(
          "SELECT COUNT(*) AS count FROM users"
        )
        .first();


    return json({
      models: models.count,
      pdfs: pdfs.count,
      users: users.count
    });
  }


  /* ADD MODEL */

  if (
    path === "/api/admin/models" &&
    method === "POST"
  ) {

    if (!isAdmin(user, env)) {
      return json({
        error: "Admin access required"
      }, 403);
    }


    const body =
      await request.json();


    const title =
      String(body.title || "").trim();

    const subject =
      String(body.subject || "").trim();

    const chapter =
      String(body.chapter || "").trim();

    const modelUrl =
      String(body.modelUrl || "").trim();


    if (
      !title ||
      !subject ||
      !chapter ||
      !modelUrl
    ) {

      return json({
        error: "All fields are required."
      }, 400);
    }


    await env.DB.prepare(`
      INSERT INTO models
      (
        title,
        subject,
        chapter,
        model_url,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `)
      .bind(
        title,
        subject,
        chapter,
        modelUrl,
        Date.now()
      )
      .run();


    return json({
      ok: true,
      message: "3D model added."
    });
  }


  /* UPLOAD FILE */

  if (
    path === "/api/admin/upload" &&
    method === "POST"
  ) {

    if (!isAdmin(user, env)) {
      return json({
        error: "Admin access required"
      }, 403);
    }


    if (!env.MEDIA) {
      return json({
        error:
          "R2 MEDIA binding is missing."
      }, 500);
    }


    const form =
      await request.formData();


    const kind =
      String(
        form.get("kind") || ""
      ).toLowerCase();


    const title =
      String(
        form.get("title") || ""
      ).trim();


    const chapter =
      String(
        form.get("chapter") || ""
      ).trim();


    const file =
      form.get("file");


    if (
      !title ||
      !chapter ||
      !(file instanceof File)
    ) {

      return json({
        error:
          "Title, chapter and file are required."
      }, 400);
    }


    if (
      kind !== "pdf" &&
      kind !== "model"
    ) {

      return json({
        error:
          "kind must be pdf or model."
      }, 400);
    }


    /*
      Sanitize filename
    */

    const safeName =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");


    const extension =
      (
        file.name
          .split(".")
          .pop() || "bin"
      ).toLowerCase();


    const key =
      `${kind}/${Date.now()}-${safeName}.${extension}`;


    await env.MEDIA.put(
      key,
      file.stream(),
      {
        httpMetadata: {
          contentType:
            file.type ||
            getContentType(extension)
        }
      }
    );


    const mediaUrl =
      `/media/${encodeURIComponent(key)}`;


    /*
      Save PDF metadata
    */

    if (kind === "pdf") {

      await env.DB.prepare(`
        INSERT INTO pdfs
        (
          title,
          chapter,
          url,
          created_at
        )
        VALUES (?, ?, ?, ?)
      `)
        .bind(
          title,
          chapter,
          mediaUrl,
          Date.now()
        )
        .run();
    }


    return json({
      ok: true,
      type: kind,
      url: mediaUrl,
      key
    });
  }


  /* =========================
     PAYMENT PLACEHOLDER
  ========================= */

  if (
    path === "/api/payment/create-order" &&
    method === "POST"
  ) {

    if (!user) {
      return json({
        error: "Login required"
      }, 401);
    }


    /*
      IMPORTANT:
      Real Razorpay order creation
      should happen here using
      server-side Razorpay secrets.

      Never put the secret key
      inside index.html.
    */


    return json({
      error:
        "Payment gateway is not configured yet."
    }, 501);
  }


  if (
    path === "/api/payment/verify" &&
    method === "POST"
  ) {

    if (!user) {
      return json({
        error: "Login required"
      }, 401);
    }


    /*
      Payment signature verification
      must be implemented server-side
      before granting premium access.
    */


    return json({
      error:
        "Payment verification is not configured yet."
    }, 501);
  }


  return json({
    error: "API endpoint not found."
  }, 404);
}


/* =========================
   SIGNUP
========================= */

async function signup(request, env) {

  const body =
    await request.json();


  const email =
    String(body.email || "")
      .trim()
      .toLowerCase();


  const password =
    String(body.password || "");


  if (!email) {

    return json({
      error: "Email is required."
    }, 400);
  }


  if (password.length < 8) {

    return json({
      error:
        "Password must contain at least 8 characters."
    }, 400);
  }


  const existing =
    await env.DB.prepare(`
      SELECT id
      FROM users
      WHERE email = ?
    `)
      .bind(email)
      .first();


  if (existing) {

    return json({
      error:
        "An account with this email already exists."
    }, 409);
  }


  const passwordHash =
    await hashPassword(password);


  /*
    The email specified in ADMIN_EMAIL
    becomes the first admin account.
  */

  const adminEmail =
    String(
      env.ADMIN_EMAIL || ""
    )
      .trim()
      .toLowerCase();


  const role =
    email === adminEmail
      ? "admin"
      : "student";


  const result =
    await env.DB.prepare(`
      INSERT INTO users
      (
        email,
        password_hash,
        role,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `)
      .bind(
        email,
        passwordHash,
        role,
        Date.now()
      )
      .run();


  const user = {
    id: result.meta.last_row_id,
    email,
    role
  };


  return createSessionResponse(
    user,
    env,
    "Account created successfully."
  );
}


/* =========================
   LOGIN
========================= */

async function login(request, env) {

  const body =
    await request.json();


  const email =
    String(body.email || "")
      .trim()
      .toLowerCase();


  const password =
    String(body.password || "");


  const user =
    await env.DB.prepare(`
      SELECT
        id,
        email,
        password_hash,
        role
      FROM users
      WHERE email = ?
    `)
      .bind(email)
      .first();


  if (
    !user ||
    !(await verifyPassword(
      password,
      user.password_hash
    ))
  ) {

    return json({
      error:
        "Invalid email or password."
    }, 401);
  }


  return createSessionResponse(
    user,
    env,
    "Login successful."
  );
}


/* =========================
   SESSION
========================= */

async function createSessionResponse(
  user,
  env,
  message
) {

  const expires =
    Math.floor(
      Date.now() / 1000
    ) +
    SESSION_DAYS * 86400;


  const payload =
    `${user.id}.${expires}`;


  const signature =
    await hmac(
      payload,
      env.AUTH_SECRET
    );


  const token =
    btoa(
      `${user.id}.${expires}.${signature}`
    )
      .replace(/=+$/, "");


  return new Response(
    JSON.stringify({
      ok: true,
      message,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    }),
    {
      headers: {
        "content-type":
          "application/json",

        "set-cookie":
          `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`
      }
    }
  );
}


/* =========================
   GET CURRENT USER
========================= */

async function getCurrentUser(
  request,
  env
) {

  const cookie =
    request.headers.get("cookie") || "";


  const match =
    cookie.match(
      new RegExp(
        `(?:^|; )${SESSION_COOKIE}=([^;]+)`
      )
    );


  if (!match) {
    return null;
  }


  try {

    const decoded =
      atob(match[1]);


    const parts =
      decoded.split(".");


    const userId =
      Number(parts[0]);


    const expires =
      Number(parts[1]);


    const signature =
      parts.slice(2).join(".");


    if (
      !userId ||
      !expires ||
      expires <
        Math.floor(Date.now() / 1000)
    ) {

      return null;
    }


    const expected =
      await hmac(
        `${userId}.${expires}`,
        env.AUTH_SECRET
      );


    if (
      !safeEqual(
        signature,
        expected
      )
    ) {

      return null;
    }


    return await env.DB
      .prepare(`
        SELECT
          id,
          email,
          role
        FROM users
        WHERE id = ?
      `)
      .bind(userId)
      .first();

  } catch {

    return null;
  }
}


/* =========================
   ADMIN CHECK
========================= */

function isAdmin(user, env) {

  if (!user) {
    return false;
  }


  if (user.role === "admin") {
    return true;
  }


  const adminEmail =
    String(
      env.ADMIN_EMAIL || ""
    )
      .trim()
      .toLowerCase();


  return (
    adminEmail &&
    user.email === adminEmail
  );
}


/* =========================
   PASSWORD HASH
========================= */

async function hashPassword(
  password
) {

  const salt =
    crypto.getRandomValues(
      new Uint8Array(16)
    );


  const key =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(
        password
      ),
      "PBKDF2",
      false,
      ["deriveBits"]
    );


  const bits =
    await crypto.subtle.deriveBits(
      {
        name:"PBKDF2",
        salt,
        iterations:150000,
        hash:"SHA-256"
      },
      key,
      256
    );


  return [
    "pbkdf2",
    "150000",
    base64(salt),
    base64(
      new Uint8Array(bits)
    )
  ].join("$");
}


/* =========================
   PASSWORD VERIFY
========================= */

async function verifyPassword(
  password,
  stored
) {

  try {

    const parts =
      stored.split("$");


    const iterations =
      Number(parts[1]);


    const salt =
      fromBase64(parts[2]);


    const expected =
      parts[3];


    const key =
      await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(
          password
        ),
        "PBKDF2",
        false,
        ["deriveBits"]
      );


    const bits =
      await crypto.subtle.deriveBits(
        {
          name:"PBKDF2",
          salt,
          iterations,
          hash:"SHA-256"
        },
        key,
        256
      );


    return safeEqual(
      base64(
        new Uint8Array(bits)
      ),
      expected
    );

  } catch {

    return false;
  }
}


/* =========================
   HMAC
========================= */

async function hmac(
  value,
  secret
) {

  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not configured."
    );
  }


  const key =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(
        secret
      ),
      {
        name:"HMAC",
        hash:"SHA-256"
      },
      false,
      ["sign"]
    );


  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        value
      )
    );


  return base64(
    new Uint8Array(signature)
  );
}


/* =========================
   R2 MEDIA
========================= */

async function serveMedia(
  request,
  env,
  path
) {

  if (!env.MEDIA) {

    return new Response(
      "R2 is not configured.",
      {status:500}
    );
  }


  const key =
    decodeURIComponent(
      path.slice(
        "/media/".length
      )
    );


  const object =
    await env.MEDIA.get(key);


  if (!object) {

    return new Response(
      "File not found.",
      {status:404}
    );
  }


  const headers =
    new Headers();


  object.writeHttpMetadata(
    headers
  );


  headers.set(
    "etag",
    object.httpEtag
  );


  headers.set(
    "cache-control",
    "public,max-age=31536000,immutable"
  );


  return new Response(
    object.body,
    {headers}
  );
}


/* =========================
   HELPERS
========================= */

function json(
  data,
  status=200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers:{
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store"
      }
    }
  );
}


function base64(bytes) {

  let binary="";

  for (
    const byte of bytes
  ) {

    binary +=
      String.fromCharCode(byte);
  }

  return btoa(binary);
}


function fromBase64(value) {

  const binary =
    atob(value);


  return Uint8Array.from(
    binary,
    char =>
      char.charCodeAt(0)
  );
}


function safeEqual(
  a,
  b
) {

  if (
    !a ||
    !b ||
    a.length !== b.length
  ) {

    return false;
  }


  let result=0;


  for (
    let i=0;
    i<a.length;
    i++
  ) {

    result |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);
  }


  return result===0;
}


function getContentType(
  extension
) {

  const types={

    pdf:
      "application/pdf",

    glb:
      "model/gltf-binary",

    gltf:
      "model/gltf+json",

    png:
      "image/png",

    jpg:
      "image/jpeg",

    jpeg:
      "image/jpeg",

    webp:
      "image/webp"

  };


  return (
    types[extension] ||
    "application/octet-stream"
  );
}
