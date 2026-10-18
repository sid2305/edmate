# Module 1: Values, types and variables

## 1.1 Values and types

Every piece of data in Python is a **value**, and every value has a **type**. This course uses four types to start with.

| Type | Examples | What it is |
| --- | --- | --- |
| `int` | `42`, `-7`, `0` | whole numbers |
| `float` | `3.5`, `-0.25`, `2.0` | numbers with a decimal point |
| `str` | `"hello"`, `'42'`, `""` | text (a "string" of characters), always in quotes |
| `bool` | `True`, `False` | yes/no values, with a capital T and F |

`type()` tells you the type of a value:

```python
print(type(42))      # <class 'int'>
print(type(4.2))     # <class 'float'>
print(type("42"))    # <class 'str'>
print(type(True))    # <class 'bool'>
```

Look closely at `"42"`: with quotes it is text, not a number.

## 1.2 Variables

A **variable** is a name that refers to a value. You create one with `=`, the assignment operator. Read `=` as "becomes", not "equals".

```python
score = 10
name = "Sam"
print(score)   # 10
print(name)    # Sam
```

Python runs your code from top to bottom, and a variable always holds its newest value. On each line the right-hand side is worked out first:

```python
x = 5
x = x + 3    # 5 + 3, so x becomes 8
x = x * 2    # 8 * 2, so x becomes 16
print(x)     # 16
```

Shortcut: `x += 3` means the same as `x = x + 3`. There are also `-=`, `*=` and `/=`.

**Naming rules**

- Use letters, digits and the underscore `_` only.
- A name cannot start with a digit: `2nd_place` is not allowed, `place_2` is.
- Names are case-sensitive: `total` and `Total` are two different variables.
- You cannot use Python's own keywords, such as `if`, `for` or `def`.
- `my-name` is not allowed, because Python reads `-` as minus. Use `my_name`.

Good names say what is inside: `price`, `total_score`, `temperature`.

## 1.3 Arithmetic

| Operator | Meaning | Example | Result |
| --- | --- | --- | --- |
| `+` | add | `7 + 2` | `9` |
| `-` | subtract | `7 - 2` | `5` |
| `*` | multiply | `7 * 2` | `14` |
| `/` | divide | `7 / 2` | `3.5` |
| `//` | floor division: divide, then round down to a whole number | `7 // 2` | `3` |
| `%` | remainder (also called modulo) | `7 % 2` | `1` |
| `**` | power | `2 ** 3` | `8` |

- `/` always gives a float, even when it divides exactly: `6 / 2` is `3.0`.
- `//` rounds **down**: `7 // 2` is `3`, and `-7 // 2` is `-4`.
- `%` gives what is left over: `17 % 5` is `2`. A number `n` is even when `n % 2` is `0`.
- The usual order applies: `**` first, then `*`, `/`, `//`, `%`, then `+` and `-`. Brackets go first of all: `2 + 3 * 4` is `14`, but `(2 + 3) * 4` is `20`.

## 1.4 Working with strings

```python
greeting = "Hello" + " " + "world"
print(greeting)        # Hello world
print("ha" * 3)        # hahaha
print(len("cat"))      # 3
```

`+` joins strings, `*` repeats a string, and `len()` counts its characters.

**f-strings** are the easiest way to put values inside text. Put `f` just before the opening quote; anything inside `{ }` is replaced by its value:

```python
name = "Sam"
total = 12
print(f"{name} scored {total} points")   # Sam scored 12 points
print(f"Total: {total}")                 # Total: 12
```

## 1.5 Converting between types

```python
print(int("42"))      # 42 (text to whole number)
print(float("3.5"))   # 3.5 (text to decimal number)
print(str(42))        # 42 (number to text: now "42")
print(int(3.9))       # 3 (int() cuts off the decimal part)
```

If the text is not a number, `int()` fails: `int("hello")` gives `ValueError: invalid literal for int() with base 10: 'hello'`.

## 1.6 input() always gives you a string

`input()` shows a message, waits for the user to type, and gives back what they typed **as a string**, even if they typed digits.

```python
age = input("How old are you? ")
print(age + 1)
```

If you type `14`, this crashes with:

```
TypeError: can only concatenate str (not "int") to str
```

`age` is the text `"14"`, and Python will not add text and a number. Convert first:

```python
age = int(input("How old are you? "))
print(age + 1)     # 15, if you typed 14
```

Also watch out: `"5" + "3"` gives `"53"`, because joining two strings sticks them together.

**Teacher's tip:** when you see an error, read the **last line** first. The error type (`TypeError`, `ValueError`, `NameError`) and the message usually tell you exactly what went wrong.

## Key points

- Every value has a type: `int`, `float`, `str` or `bool`.
- `=` stores a value in a variable; the newest value wins.
- `/` gives a float, `//` rounds down, `%` gives the remainder.
- `input()` always returns a string; use `int()` or `float()` to get a number.
