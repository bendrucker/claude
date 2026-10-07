<out>Title: Clean up GitHub Actions workflow

Fixes some issues from #152 

* Duplicate trigger when opening PRs from this repo (no fork)
* Remove Yarn, `npm` is just fine
* Lint on latest LTS only
* Test always, even if lint fails
* Don't check types on multiple Node versions
* Remove useless `actions/checkout` option (workflow only has read permissions so `persist-credentials: false` is unimportant)
</out>
