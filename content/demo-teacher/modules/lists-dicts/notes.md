# Module 5: Lists and dictionaries

## 5.1 Lists

A **list** holds several values in order, inside square brackets:

```python
colours = ["red", "green", "blue"]
print(colours[0])     # red
print(colours[2])     # blue
print(colours[-1])    # blue (negative indexes count from the end)
print(len(colours))   # 3
```

Positions, called **indexes**, start at **0**. A list of 3 items has indexes 0, 1 and 2, so `colours[3]` gives:

```
IndexError: list index out of range
```

## 5.2 Changing a list

Lists can be changed after you make them:

```python
pets = ["cat", "dog", "fish"]
pets[1] = "rabbit"         # replace the item at index 1
pets.append("hamster")     # add to the end
print(pets)                # ['cat', 'rabbit', 'fish', 'hamster']
pets.remove("cat")         # remove the first matching item
print(pets)                # ['rabbit', 'fish', 'hamster']
print("fish" in pets)      # True
```

`in` checks whether a value is in the list and gives `True` or `False`.

## 5.3 Lists of numbers

```python
nums = [4, 8, 15]
print(len(nums))    # 3
print(sum(nums))    # 27
print(max(nums))    # 15
print(min(nums))    # 4
print(nums[0:2])    # [4, 8]
```

`nums[0:2]` is a **slice**: the items from index 0 up to, but not including, index 2. Like `range()`, the stop is left out.

## 5.4 Looping over a list

A `for` loop goes through a list item by item, so you never need to count indexes:

```python
scores = [7, 9, 4]
total = 0
for s in scores:
    total += s
print(total)                 # 20
print(total / len(scores))   # 6.666666666666667 (the average)
```

## 5.5 Dictionaries

A **dictionary** stores pairs: each **key** points to a **value**. You look things up by key, not by position.

```python
stock = {"apples": 3, "pears": 5}
print(stock["pears"])   # 5
stock["apples"] = 10    # change a value
stock["kiwis"] = 2      # add a new key and value
print(stock)            # {'apples': 10, 'pears': 5, 'kiwis': 2}
```

Positions do not work: `stock[0]` gives `KeyError: 0`, because there is no key `0`.

A key that is not there also gives a `KeyError`: `stock["plums"]` gives `KeyError: 'plums'`. Two safe ways to look up a key that might be missing:

```python
if "plums" in stock:
    print(stock["plums"])
else:
    print("No plums")

print(stock.get("plums", 0))   # 0: .get() gives the default instead of an error
```

## 5.6 Looping over a dictionary

```python
stock = {"apples": 3, "pears": 5}
for fruit, count in stock.items():
    print(f"{fruit}: {count}")
```

This prints `apples: 3` and `pears: 5`. `.items()` gives each key with its value. A plain `for fruit in stock:` goes through the keys only.

## 5.7 List or dictionary?

- Use a **list** for things in order that you reach by position: a shopping list, a row of scores.
- Use a **dictionary** when you look things up by a name: stock by fruit, a phone book by name.

## Key points

- List indexes start at 0; `[-1]` is the last item.
- `.append()` adds to the end of a list; `len()`, `sum()`, `max()` and `min()` work on lists of numbers.
- Dictionaries are looked up by key. Use `in` or `.get()` when a key might be missing.
- `for key, value in d.items():` loops over a dictionary's pairs.
