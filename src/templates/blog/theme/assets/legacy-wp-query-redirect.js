(function () {
  var script = document.currentScript;
  var postPathPattern = script && script.dataset ? script.dataset.postPath : "";
  var outputStyle = script && script.dataset ? script.dataset.outputStyle || "directory" : "directory";
  var query = new URLSearchParams(window.location.search);
  var publicId = query.get("p");

  if (window.location.pathname !== "/" || !postPathPattern || !publicId) {
    return;
  }

  publicId = publicId.trim();
  if (!/^[1-9][0-9]*$/.test(publicId)) {
    return;
  }

  var segments = postPathPattern.split("/").filter(Boolean);
  if (segments.indexOf(":public_id") === -1 || segments.some(function (segment) {
    return segment.charAt(0) === ":" && segment !== ":public_id";
  })) {
    return;
  }
  if (outputStyle !== "directory" && outputStyle !== "html-extension") {
    return;
  }

  var pathname = "/" + segments.map(function (segment) {
    return segment === ":public_id" ? encodeURIComponent(publicId) : segment;
  }).join("/");
  if (outputStyle === "directory") {
    pathname += "/";
  }

  var destination;
  try {
    destination = new URL(pathname, window.location.origin);
  } catch (error) {
    return;
  }
  if (destination.origin !== window.location.origin) {
    return;
  }

  destination.hash = window.location.hash;
  window.location.replace(destination.href);
}());
