import { PatternSpec } from '../../contracts';
import { dialectOf } from '../syntax/dialects';

export interface CodeSnippet {
  language: string;
  code: string;
}

const MAX_SAMPLE = 400;

function dq(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
}

function sample(text: string): string {
  return text.length > MAX_SAMPLE ? text.slice(0, MAX_SAMPLE) : text;
}

function inlineFlags(flags: string, allowed: string): string {
  const f = [...flags].filter((c) => allowed.includes(c)).join('');
  return f ? `(?${f})` : '';
}

/**
 * Generates idiomatic code for the pattern's own language: find every match, then replace (US-15).
 * Every string is escaped for its language, so the pattern that runs is exactly the one tested here.
 */
export function generateCode(spec: PatternSpec, replacement: string, text: string): CodeSnippet {
  const d = dialectOf(spec.flavor);
  const global = spec.flags.includes('g');
  const t = sample(text);
  switch (spec.flavor) {
    case 'ecmascript': {
      const flags = spec.flags;
      const literal = `/${spec.source.replace(/(^|[^\\])\//g, '$1\\/').replace(/\n/g, '\\n')}/${flags}`;
      return {
        language: d.language,
        code: [
          `const regex = ${literal};`,
          `const text = ${dq(t)};`,
          '',
          global
            ? `for (const m of text.matchAll(regex)) {\n  console.log(m.index, m[0], m.groups ?? m.slice(1));\n}`
            : `const m = regex.exec(text);\nif (m) console.log(m.index, m[0], m.groups ?? m.slice(1));`,
          '',
          `const result = text.replace(regex, ${dq(replacement)});`,
        ].join('\n'),
      };
    }
    case 'pcre': {
      const mods = [...spec.flags].filter((c) => 'imsxuU'.includes(c)).join('');
      const sq = (s: string) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
      const re = sq(`/${spec.source.replace(/\//g, '\\/')}/${mods}`);
      return {
        language: 'PHP',
        code: [
          '<?php',
          `$re = ${re};`,
          `$str = ${sq(t)};`,
          '',
          global ? 'preg_match_all($re, $str, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);' : 'preg_match($re, $str, $matches, PREG_OFFSET_CAPTURE);',
          'print_r($matches);',
          '',
          `$result = preg_replace($re, ${sq(replacement)}, $str${global ? '' : ', 1'});`,
        ].join('\n'),
      };
    }
    case 'python': {
      const names: Record<string, string> = { i: 're.IGNORECASE', m: 're.MULTILINE', s: 're.DOTALL', x: 're.VERBOSE', a: 're.ASCII' };
      const flags = [...spec.flags].filter((c) => c in names).map((c) => names[c]).join(' | ');
      const raw = (s: string) => (!s.includes('"') && !/\\$/.test(s.replace(/\\\\/g, '')) && !s.includes('\n') ? `r"${s}"` : dq(s));
      return {
        language: d.language,
        code: [
          'import re',
          '',
          `regex = re.compile(${raw(spec.source)}${flags ? ', ' + flags : ''})`,
          `text = ${dq(t)}`,
          '',
          global
            ? 'for m in regex.finditer(text):\n    print(m.start(), m.group(0), m.groupdict() or m.groups())'
            : 'm = regex.search(text)\nif m:\n    print(m.start(), m.group(0), m.groupdict() or m.groups())',
          '',
          `result = regex.sub(${raw(replacement)}, text${global ? '' : ', count=1'})`,
        ].join('\n'),
      };
    }
    case 'java': {
      const names: Record<string, string> = { i: 'Pattern.CASE_INSENSITIVE', m: 'Pattern.MULTILINE', s: 'Pattern.DOTALL', x: 'Pattern.COMMENTS', u: 'Pattern.UNICODE_CASE' };
      const flags = [...spec.flags].filter((c) => c in names).map((c) => names[c]).join(' | ');
      return {
        language: d.language,
        code: [
          'import java.util.regex.Matcher;',
          'import java.util.regex.Pattern;',
          '',
          `Pattern pattern = Pattern.compile(${dq(spec.source)}${flags ? ', ' + flags : ''});`,
          `String text = ${dq(t)};`,
          '',
          'Matcher m = pattern.matcher(text);',
          global ? 'while (m.find()) {\n    System.out.println(m.start() + ": " + m.group());\n}' : 'if (m.find()) {\n    System.out.println(m.start() + ": " + m.group());\n}',
          '',
          `String result = pattern.matcher(text).${global ? 'replaceAll' : 'replaceFirst'}(${dq(replacement)});`,
        ].join('\n'),
      };
    }
    case 'dotnet': {
      const names: Record<string, string> = { i: 'RegexOptions.IgnoreCase', m: 'RegexOptions.Multiline', s: 'RegexOptions.Singleline', x: 'RegexOptions.IgnorePatternWhitespace', n: 'RegexOptions.ExplicitCapture' };
      const flags = [...spec.flags].filter((c) => c in names).map((c) => names[c]).join(' | ');
      const verbatim = (s: string) => '@"' + s.replace(/"/g, '""') + '"';
      return {
        language: d.language,
        code: [
          'using System.Text.RegularExpressions;',
          '',
          `var regex = new Regex(${verbatim(spec.source)}${flags ? ', ' + flags : ''});`,
          `var text = ${dq(t)};`,
          '',
          global
            ? 'foreach (Match m in regex.Matches(text))\n{\n    Console.WriteLine($"{m.Index}: {m.Value}");\n}'
            : 'var m = regex.Match(text);\nif (m.Success) Console.WriteLine($"{m.Index}: {m.Value}");',
          '',
          `var result = regex.Replace(text, ${verbatim(replacement)}${global ? '' : ', 1'});`,
        ].join('\n'),
      };
    }
    case 'rust': {
      const src = inlineFlags(spec.flags, 'imsxUR') + spec.source;
      const hashes = '#'.repeat(Math.max(1, ...[...src.matchAll(/"(#*)/g)].map((m) => m[1].length + 1)));
      return {
        language: d.language,
        code: [
          'use regex::Regex;',
          '',
          'fn main() {',
          `    let re = Regex::new(r${hashes}"${src}"${hashes}).unwrap();`,
          `    let text = ${dq(t)};`,
          '',
          global
            ? '    for caps in re.captures_iter(text) {\n        let m = caps.get(0).unwrap();\n        println!("{}: {}", m.start(), m.as_str());\n    }'
            : '    if let Some(caps) = re.captures(text) {\n        let m = caps.get(0).unwrap();\n        println!("{}: {}", m.start(), m.as_str());\n    }',
          '',
          `    let result = re.${global ? 'replace_all' : 'replace'}(text, ${dq(replacement)});`,
          '}',
        ].join('\n'),
      };
    }
    case 'go': {
      const src = inlineFlags(spec.flags, 'imsU') + spec.source;
      const lit = src.includes('`') ? dq(src) : '`' + src + '`';
      return {
        language: d.language,
        code: [
          'package main',
          '',
          'import (',
          '\t"fmt"',
          '\t"regexp"',
          ')',
          '',
          'func main() {',
          `\tre := regexp.MustCompile(${lit})`,
          `\ttext := ${dq(t)}`,
          '',
          global
            ? '\tfor _, m := range re.FindAllStringSubmatchIndex(text, -1) {\n\t\tfmt.Println(m[0], text[m[0]:m[1]])\n\t}'
            : '\tif m := re.FindStringSubmatchIndex(text); m != nil {\n\t\tfmt.Println(m[0], text[m[0]:m[1]])\n\t}',
          '',
          `\tresult := re.ReplaceAllString(text, ${dq(replacement)})`,
          '\tfmt.Println(result)',
          '}',
        ].join('\n'),
      };
    }
  }
}
