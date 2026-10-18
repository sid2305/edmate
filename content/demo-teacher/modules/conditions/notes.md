# Module 2: Making decisions with if

## 2.1 Comparisons give True or False

| Operator | Meaning |
| --- | --- |
| `==` | equal to |
| `!=` | not equal to |
| `<` | less than |
| `>` | greater than |
| `<=` | less than or equal to |
| `>=` | greater than or equal to |

A comparison is a question, and the answer is a `bool`:

```python
print(5 == 5)          # True
print(5 != 5)          # False
print(3 > 7)           # False
print("Yes" == "yes")  # False: capital letters matter
```

**Watch out:** `=` stores a value, `==` asks "are these equal?". Writing `if score = 10:` is a `SyntaxError`. Write `if score == 10:`.

## 2.2 if and else

```python
temp = 35
if temp > 30:
    print("Hot")
else:
    print("Not hot")
print("Done")
```

This prints `Hot` and then `Done`.

- The `if` line and the `else` line end with a colon `:`.
- The lines that belong to a branch are **indented** by 4 spaces. They run only when that branch is chosen.
- The line that is not indented (`print("Done")`) runs every time, after the `if`.
- A missing colon gives a `SyntaxError`. Indentation that does not line up gives an `IndentationError`.

## 2.3 elif: more than two choices

```python
temp = 25
if temp > 30:
    print("Hot")
elif temp > 20:
    print("Warm")
else:
    print("Cool")
```

This prints `Warm`. Python checks the conditions from top to bottom and runs **only the first branch whose condition is True**; it skips the rest. `else` is optional and catches everything that no condition matched.

**Order matters.** This code never prints `Distinction`:

```python
marks = 85
if marks >= 50:
    print("Pass")
elif marks >= 80:
    print("Distinction")   # never reached: 85 already matched marks >= 50
```

Any mark of 80 or more is also 50 or more, so the first branch always wins. Put the strictest check first:

```python
marks = 85
if marks >= 80:
    print("Distinction")
elif marks >= 50:
    print("Pass")
else:
    print("Try again")
```

**elif or a new if?** In an `if`/`elif`/`else` chain, at most one branch runs. Separate `if` statements are each checked on their own, so more than one can run.

## 2.4 and, or, not

- `a and b` is True only when **both** are True.
- `a or b` is True when **at least one** is True.
- `not a` flips True to False and False to True.

```python
age = 15
has_ticket = True
if age >= 13 and has_ticket:
    print("You can go in")

print(5 > 3 and 2 > 4)   # False: the second part is False
print(5 > 3 or 2 > 4)    # True: the first part is True
print(not True)          # False
```

To check that `n` is between 1 and 10 (including 1 and 10), write `n >= 1 and n <= 10`. Python also lets you chain it: `1 <= n <= 10`.

## 2.5 Two everyday checks

Even or odd, using the remainder from Module 1:

```python
n = 7
if n % 2 == 0:
    print("Even")
else:
    print("Odd")
```

A yes/no answer that ignores capital letters. `.lower()` gives a lowercase copy of a string, so `"YES"`, `"Yes"` and `"yes"` all match:

```python
answer = input("Continue? (yes/no) ")
if answer.lower() == "yes":
    print("Continuing")
else:
    print("Stopping")
```

## Key points

- Comparisons give `True` or `False`; use `==` to compare, never `=`.
- End `if`, `elif` and `else` lines with `:` and indent the body by 4 spaces.
- Only the first matching branch of a chain runs, so put the strictest condition first.
- Combine conditions with `and`, `or` and `not`.
