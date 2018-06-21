/* global Vue filesize timeago */

// Utilities ///////////////////////////////////////////////////////////////////

const bucketXML = async (bucket, region, marker = "") => {
  /* Fetches XML from S3 bucket, continuing at marker if supplied.
   * Returns a list of XML elements, one per file.
   */
  var contents = []
  var url = "http://" + bucket + ".s3." + region + ".amazonaws.com/"

  if (marker != "") {
    url += "?marker=" + encodeURIComponent(marker)
  }

  const text = await fetch(url).then(response => response.text())
  const xml = new window.DOMParser().parseFromString(text, "text/xml")

  contents.push.apply(contents, xml.getElementsByTagName("Contents"))

  if (xml.getElementsByTagName("IsTruncated")[0].textContent == "true") {
    marker = contents[contents.length - 1].getElementsByTagName("Key")[0]
      .textContent
    console.log("need more results: " + marker)
    contents.push.apply(contents, await bucketXML(bucket, region, marker))
  }

  return contents
}

const reverseSortReleases = tree => {
  /* Reverse sort file list in directories with releases to show newest
   * releases first. Recursive.
   *
   * If the first object in a directory starts with a number,
   * assume the directory contains a list of releases.
   * 1. Reverse the list so that the newest release is first.
   * 2. Hide all children
   * 3. Find the first child in the list starting with a number and show it
   */
  if (tree.children.length > 0 && /^\d/.test(tree.children[0].name)) {
    tree.children.reverse()
    for (const child of tree.children) {
      child.show = false
    }
    var index = 0
    while (!/^\d/.test(tree.children[index].name)) {
      index++
    }
    tree.children[index].show = true
  }
  for (const child of tree.children) {
    reverseSortReleases(child)
  }
}

const bucketFileList = async (bucket, contents) => {
  /* Turns a list of XML S3 object entries into a list of dictionaries.
   * Each dictionary contains information about the file.
   */
  var fileList = []

  for (const f of contents) {
    const key = f.getElementsByTagName("Key")[0].textContent
    if (!key.includes("/") || key.includes("dists/")) {
      continue
    }

    fileList.push({
      children: [],
      downloadURL: "http://" + bucket + "/" + key,
      lastModified: new Date(
        f.getElementsByTagName("LastModified")[0].textContent
      ),
      name: key.split("/").pop(),
      path: key,
      show: true,
      size: filesize(Number(f.getElementsByTagName("Size")[0].textContent)),
    })
  }

  return fileList
}

const initTree = bucket => {
  return {
    children: [],
    id: 0,
    name: bucket,
    show: true,
  }
}

const loadTreeFromFileList = (list, tree) => {
  /* Transforms an S3 list into a tree of pseudo-directories and files.
   */

  var id = 1
  for (const f of list) {
    var tmp = tree

    f.path.split("/").forEach((element, index, array) => {
      if (array.slice(index + 1).length == 0) {
        // file
        f.id = id++
        tmp.children.push(f)
      } else {
        // directory
        var exists = false
        for (const child of tmp.children) {
          if (child.name == element) {
            exists = true
            break
          }
        }
        if (!exists) {
          tmp.children.push({
            children: [],
            id: id++,
            name: element,
            show: true,
          })
        }
        tmp = tmp.children[tmp.children.length - 1]
      }
    })
  }

  reverseSortReleases(tree)
}

// Basic component for recursion. Formats our description lists.
Vue.component("archive-folder", {
  props: ["folder"],
  template: `
  <dl>
    <dt><archive-heading :folder="folder"></archive-heading></dt>
    <dd v-for="child in folder.children" v-if="folder.show">
      <archive-item v-if="child.children.length == 0" :file="child"></archive-item>
      <archive-folder v-else :folder="child"></archive-folder>
    </dd>
  </dl>
  `,
})

// Directory name and a link to toggle showing the contents of the directory.
Vue.component("archive-heading", {
  props: ["folder"],
  template: `
  <a href="#" v-on:click.prevent="folder.show = !folder.show" :key="folder.show">
    <span v-show="!folder.show">▸</span><span v-show="folder.show">▾</span> {{ folder.name }}/
  </a>
  `,
})

// Single file download link.
Vue.component("archive-item", {
  props: ["file", "fullPath"],
  template: `
  <div>
    <a v-if="fullPath == true" :href="file.downloadURL">{{ file.path }}</a>
    <a v-else :href="file.downloadURL">{{ file.name }}</a>
    <small>({{ file.size }}, {{ timeago().format(file.lastModified) }})</small>
  </div>
  `,
})

// Proceed /////////////////////////////////////////////////////////////////////

var title = location.host + " Listing"
switch (location.host) {
  case "archive.openswitch.net":
    title = "OPX Archive Listing"
    break
  case "deb.openswitch.net":
    title = "OPX Debian Package Listing"
    break
}

const weekAgo = new Date()
weekAgo.setDate(weekAgo.getDate() - 7)

const app = new Vue({
  el: "#app",
  data: {
    title: title,
    query: "",
    tree: initTree(location.host),
    list: [],
  },
  computed: {
    queryResults: function() {
      if (this.query == "") {
        return []
      } else {
        return this.list.filter(item => {
          return (
            item.path.toLowerCase().indexOf(this.query.toLowerCase()) !== -1
          )
        })
      }
    },
    recent: function() {
      return this.list
        .filter(file => file.lastModified > weekAgo)
        .sort((f1, f2) => f2.lastModified - f1.lastModified)
    },
  },
})

// Load fake file to indicate loading status.
app.tree.children.push({
  name: "Loading data...",
  children: [],
  downloadURL: "http://" + location.host + ".s3-us-west-2.amazonaws.com/",
})

bucketXML(location.host, "us-west-2").then(contents => {
  bucketFileList(location.host, contents).then(list => {
    // Remove loading "file"
    app.tree.children.pop()
    // Load downloaded list
    app.list = list
    // Hide the tree for huge buckets (performance)
    if (app.list.length > 10000) {
      app.tree.show = false
    }
    loadTreeFromFileList(app.list, app.tree)
  })
})
