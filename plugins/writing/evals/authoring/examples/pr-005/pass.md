<out>
Generate readme input/output docs

By generating an input table, we're (relatively) guaranteed updated data. An improvement would be to wrap this content in comments indicating how the content is generated, somewhat akin to `//go:generate`, but with comment blocks fencing off the the resulting output in the markdown instead. I'm sure something like this exists but I can't find it. With that, you could run the generator in an Actions workflow and be guaranteed that if docs are out of date a check fails.
</out>
