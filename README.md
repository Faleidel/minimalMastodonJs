# How to send a message to a mastodon user from your own server

## How to run
The main.js file can be run on a server with a reverse proxy that enable https, you only need to adjust the `host` variable at the start of the file. Instructions on how to deploy an https server with ngnix with lets encrypt and digital ocean can be found here: [https://www.digitalocean.com/community/tutorials/how-to-set-up-a-node-js-application-for-production-on-ubuntu-16-04](https://www.digitalocean.com/community/tutorials/how-to-set-up-a-node-js-application-for-production-on-ubuntu-16-04).

Please note that the API used to generate cryptographic keys needs nodejs v10.12.0 at least to run.

## Quick explanation

There are 3 parts to sending a post to someone else on mastodon. First your user (that will send the message) must be listed in a special ".well-known/webfinger" url. Second the user must have a page with a public encryption key (and you must store the private key). Third you must post your message to the target mastodon server with a special header that encrypt some http headers for security reasons.

When you post your message to the receiving mastodon server it will send a request to your /.well-known/webfinger endpoint to get the url of the user that created the post. It will then fetch the JSON at that url to get the public key that you used to sign your request to create a new post. So we need to set up two end points and to send one request.

Please note that since we generate the public / private key each time you start the server and never store it you need to change the user name each time so mastodon is not confused that you are changing your user public key all the time.

## Part 1: webfinger;

A webfinger query looks like this:

    /.well-known/webfinger?resource=acct:someUser@mastodon.social

To which the server should answer:

    {
        subject: "acct:someUser@mastodon.social",
        links: [{
            rel: "self",
            type: "application/activity+json",
            href: "https://myMastodonServer.com/users/someUser"
        }]
    }

The /.well-known/ path is always the same on all server but other servers don't know that you store user informations at /users/someUser for example so they need this api to get the url.

## Part 2: User Page

Once mastodon know's your user url it will try to get it's encryption key which is in the user object. The user object will look like this:

    {
        // The @context is like a type. So this object is of type activitystreams and security
        "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/security/v1"
        ],
        
        "id": ,"https://myMastodonServer.com/users/someUser"
        "type": "Person",
        "preferredUsername": "someUser",
        
        // For mastodon only, they don't realy exist. but in a real server you will want to implement them
        // They are used to get messages and for clients to send message as this user
        "inbox": "https://myMastodonServer.com/users/someUser/inbox",
        "outbox": "https://myMastodonServer.com/users/someUser/outbox",
        
        "publicKey": {
            "id": "https://myMastodonServer.com/users/someUser#main-key",
            "owner": "https://myMastodonServer.com/users/someUser",
            "publicKeyPem": (the public key in base64)
        }
    }

The public key is an rsa keypaire in base64 the details of which I don't unserstand but can be generated like this:

    const { generateKeyPair } = require("crypto");
    
    generateKeyPair('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'pkcs1',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs1',
          format: 'pem',
        }
    }, (err, publicKey, privateKey) => {
        console.log(publicKey, privateKey);
    });

## Part 3: sending the request

To send the message you need an activity telling mastodon that you created a message.

    {
        "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/security/v1"
        ],
        id: "https://myMastodonServer.com/activity/someRandomId",
        type: "Create",
        cc: "https://mastodon.social/users/faleidel", // this is the user page of the person we want to send the message to
        published: "Tue, 27 Nov 2018 02:48:48 GMT",
        actor: "https://myMastodonServer.com/users/someUser", // the person sending the message
        to: ["https://www.w3.org/ns/activitystreams#Public"], // this is a special value meaning that the message is public
        object: { // the object of the activity is the actual post created by the "Create" activity
            type: "Note",
            id: "https://myMastodonServer.com/post/someRandomId".
            url: "https://myMastodonServer.com/post/someRandomId".
            attachment: [],
            attributedTo: "someUser",
            to: ["https://www.w3.org/ns/activitystreams#Public"],
            cc: "https://mastodon.social/users/faleidel",
            content: "This is the content of my post.",
            published: "Tue, 27 Nov 2018 02:48:48 GMT",
            sensitive: false,
            summary: null,
            tag: [{ // Listing someone in a "Mention" tag will send him a notification. In this case, we want the person to which the message is adressed to get a notification.
                type: "Mention",
                href: "https://mastodon.social/users/faleidel",
                name: "@faleidel@mastodon.social"
            }]
        }
    };

And you will post this JSON to "https://mastodon.social/inbox". But for mastodon to accept it the http post request need a special "Signature" header and a "Date" header. This content of the signature header will look like this:

    keyId="https://myMastodonServer.com/users/someUser#main-key",algorithm="rsa-sha256",headers="date",signature="..."

The signature part of the "Signature:" header is a string like this:

    date: Tue, 27 Nov 2018 02:48:48 GMT

Signed with the private key of the public key in your user object and encoded in base64. This is important since the mastodon server will check that the signed date is within a 30s window or else it will send you an error message.

You can decide to sign more headers if you want. To do this you add the header to the headers list (like this: "date host server etag") and sign a string like this (yes the headers must be in lower case):

    date: ...
    host: ...
    etag: ...

The server should then send you a status code of 202 telling you it created the message!