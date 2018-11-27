const http = require("http");
const urlUtils = require("url");

const { generateKeyPair } = require("crypto");
const createSign = require("crypto").createSign;

const request = require("request");


const port = "";
const protocol = "https";
const host = "irontree.tripbullet.com";

const baseUrl = protocol + "://" + host + (port ? (":" + port) : "");

function urlForPath(path) {
    return baseUrl + "/" + path;
}

// Our test user.
let user = {
    publicKey:  "",
    privateKey: "",
    name: "testUser"
};


// Will sign a string with a private key with RSA-SHA256 algorithm. Result will the base64 encoded
function signString(key, content) {
    let sign = createSign("RSA-SHA256");
    sign.update(content);
    
    return sign.sign(key, "base64");
}

// Create an activity with an associated Note given a content. The user is simply hard coded
function newActivity(content) {
    let post = {
        id: Math.random()*10000000000000000,
        type: "Note",
        content: content,
        published: new Date().toISOString(),
        to: ["https://www.w3.org/ns/activitystreams#Public"]
    };
    
    let act = {
        id: Math.random()*10000000000000000,
        type: "Create",
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        actor: urlForPath("/user/" + user.name),
        published: new Date().toISOString(),
        object: post
    };
    
    return act;
}

// A test activity that we will send to mastodon.social
let testActivity = newActivity(`This will be the content of my new post from ${user.name}.`);

// Return an activitystream complient JSON for a given activity.
function activityToJSON(activity) {
    return {
        "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/security/v1"
        ],
        id: urlForPath("activity/" + activity.id), // these paths are actually made up
        type: "Create",
        cc: "https://mastodon.social/users/faleidel",
        published: activity.published,
        actor: urlForPath("users/" + user.name),
        to: activity.to,
        object: {
            "@context": [
                "https://www.w3.org/ns/activitystreams",
                "https://w3id.org/security/v1"
            ],
            type: "Note",
            id: urlForPath("post/" + activity.object.id), // these paths are actually made up
            url: urlForPath("post/" + activity.object.id),
            attachment: [],
            attributedTo: user.name,
            to: activity.object.to,
            cc: "https://mastodon.social/users/faleidel",
            content: activity.object.content,
            published: activity.object.published,
            sensitive: false,
            summary: null,
            tag: [{ // Listing someone in a "Mention" tag will send him a notification
                type: "Mention",
                href: "https://mastodon.social/users/faleidel",
                name: "@faleidel@mastodon.social"
            }]
        }
    };
}

// Generate a privateKey + publicKey
function generateUserKeyPair() {
    return new Promise((resolve, reject) => {
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
            resolve({
                publicKey,
                privateKey
            });
        });
    });
}

// We generate the user keys and then start the server and send the activity
generateUserKeyPair().then(keys => {
    user.publicKey = keys.publicKey;
    user.privateKey = keys.privateKey;
    
    startServer();
    sendActivity();
});

function startServer() {
    http.createServer(function (req, res) {
        let parsed = urlUtils.parse(req.url, true);
        let query = parsed.query;
        let url = parsed.pathname.split("/");
        if (url[0] == "") url.splice(0,1);
        if (url[url.length-1] == "") url.splice(url.length-1,1);
        
        console.log("Request on url: ", url);
        
        if (url[0] == "user") {
            let name = url[1];
            
            if (name == user.name) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    "@context": [
                        "https://www.w3.org/ns/activitystreams",
                        "https://w3id.org/security/v1"
                    ],
                    
                    "id": urlForPath("user/" + name),
                    "type": "Person",
                    "preferredUsername": name,
                    
                    // for legacy only, they don't realy exist. but in a real server you will want to implement them
                    "inbox": urlForPath("user/" + name + "/inbox"),
                    "outbox": urlForPath("user/" + name + "/outbox"),
                    
                    "publicKey": {
                        "id": urlForPath("user/" + name + "#main-key"),
                        "owner": urlForPath("user/" + name),
                        "publicKeyPem": user.publicKey
                    }
                }));
            }
            else {
                res.statusCode = 404;
                res.end("Error, no such user");
            }
        }
        else if (url[0] == "activity") {
            let activityId = url[1];
            
            if (testActivity.id == activityId) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(activityToJSON(testActivity)));
            }
            else {
                res.statusCode = 404;
                res.end("Error, no such post");
            }
        }
        else if (url[0] == "post") {
            let postId = url[1];
            
            if (testActivity.object.id == postId) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(activityToJSON(testActivity).object));
            }
            else {
                res.statusCode = 404;
                res.end("Error, no such post");
            }
        }
        else if (url[0] == ".well-known") {
            if (url[1] == "webfinger") {
                if (typeof query.resource == "string") {
                    let userQuery = query.resource.split("acct:")[1];
                    let userName = userQuery.split("@")[0];
                    
                    if (userName == user.name) {
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({
                            "subject": "acct:" + userQuery,
                            
                            "links": [{
                                "rel": "self",
                                "type": "application/activity+json",
                                "href": urlForPath("user/" + userName)
                            }]
                        }));
                    }
                    else {
                        res.statusCode = 404;
                        res.end("Error, no such user");
                    }
                }
            }
            else
                res.end("Error with url");
        }
        else
            res.end("Error, nothing to do with this url");
    }).listen(9090,'localhost');
}

function sendActivity() {
    let from = user.name;
    
    let date = new Date().toUTCString();
    
    // We need this "Signature" header (from the https://tools.ietf.org/id/draft-cavage-http-signatures-07.html spec) for mastodon to accept the request.
    let stringToSign = `date: ${date}`;
    let signedString = signString(user.privateKey, stringToSign);
    let signature    = `keyId="${urlForPath('user/'+user.name)}#main-key",algorithm="rsa-sha256",headers="date",signature="${signedString}"`;
    
    let options = {
        url:  "https://mastodon.social/inbox",
        headers: {
            Host      : "mastodon.social",
            Date      : date,
            Signature : signature,
        },
        body: JSON.stringify(activityToJSON(testActivity))
    };
    
    request.post(options, (err, resp, body) => {
        console.log("Activity sent.", err, body);
    });
}